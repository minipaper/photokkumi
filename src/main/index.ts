import { app, BrowserWindow, dialog, ipcMain, nativeImage, protocol, session } from 'electron'
import { open, readFile } from 'node:fs/promises'
import { basename, extname, join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AssetKind, ImageAsset, Result, SaveRequest } from '../shared/model'
import { inspectImage, MAX_FILE_BYTES, MAX_OUTPUT_BYTES } from './images'
import { saveUnique, SaveCleanupError } from './files'
import { trustedSender, validSaveRequest } from './security'

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }])
app.enableSandbox()
let win: BrowserWindow | null = null
let photo: (ImageAsset & { path: string }) | null = null
let busy = false
let pendingClose: string | null = null
let allowClose = false
let quitRequested = false
const developmentUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
const pageUrl = developmentUrl ? new URL(developmentUrl).href : 'app://bundle/index.html'

async function choose(kind: AssetKind): Promise<ImageAsset | null> {
  if (!win) throw new Error('창을 사용할 수 없습니다.')
  const result = await dialog.showOpenDialog(win, {
    title: kind === 'photo' ? '사진 한 장 열기' : 'PNG 스티커 한 장 열기',
    properties: ['openFile'],
    filters: [{ name: kind === 'photo' ? 'JPG / PNG' : 'PNG', extensions: kind === 'photo' ? ['jpg', 'jpeg', 'png'] : ['png'] }]
  })
  if (result.canceled || !result.filePaths[0]) return null
  const path = result.filePaths[0]
  const handle = await open(path, 'r')
  let bytes: Buffer
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error('파일은 32 MiB 이하여야 합니다.')
    // Fixed allocation bounds memory even if the file grows after stat.
    const buffer = Buffer.alloc(stat.size)
    let offset = 0
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset)
      if (!bytesRead) break
      offset += bytesRead
    }
    bytes = buffer.subarray(0, offset)
  } finally { await handle.close() }
  const info = inspectImage(bytes, kind)
  if (nativeImage.createFromBuffer(bytes).isEmpty()) throw new Error('이미지를 디코딩할 수 없습니다.')
  const asset: ImageAsset = { id: randomUUID(), name: basename(path), ...info, bytes }
  if (kind === 'photo') photo = { ...asset, path, bytes: new Uint8Array() }
  return asset
}

async function save(request: SaveRequest): Promise<string | null> {
  if (!validSaveRequest(request) || !photo || request.photoId !== photo.id) throw new Error('유효하지 않은 저장 요청입니다.')
  if (request.png.byteLength > MAX_OUTPUT_BYTES) throw new Error('저장 이미지가 너무 큽니다.')
  const info = inspectImage(request.png, 'photo', true)
  if (info.width !== photo.width || info.height !== photo.height) throw new Error('출력 크기가 원본과 다릅니다.')
  const decoded = nativeImage.createFromBuffer(Buffer.from(request.png))
  if (decoded.isEmpty()) throw new Error('저장 이미지가 손상되었습니다.')
  const png = decoded.toPNG() // Re-encode only decoded pixels, never copy source metadata.
  const selected = await dialog.showOpenDialog(win!, { title: '결과를 저장할 폴더', properties: ['openDirectory', 'createDirectory'] })
  if (selected.canceled || !selected.filePaths[0]) return null
  try { return basename(await saveUnique(selected.filePaths[0], photo.path, png)) }
  catch (error) {
    if (error instanceof SaveCleanupError) throw error
    throw new Error('저장하지 못했습니다. 폴더 권한·여유 공간을 확인하세요. 편집 내용은 유지됩니다.', { cause: error })
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180, height: 820, minWidth: 760, minHeight: 580, title: '포토꾸미',
    webPreferences: { preload: join(__dirname, '../preload/index.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true }
  })
  allowClose = false; pendingClose = null; quitRequested = false
  win.on('close', event => {
    if (allowClose || (!photo && !busy)) return
    event.preventDefault()
    if (!pendingClose) {
      pendingClose = randomUUID()
      win?.webContents.send('window:close-requested', pendingClose)
    }
  })
  win.removeMenu()
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', event => event.preventDefault())
  win.webContents.on('will-attach-webview', event => event.preventDefault())
  win.on('closed', () => { win = null; photo = null; pendingClose = null })
  void win.loadURL(pageUrl)
}

app.whenReady().then(() => {
  const bundleRoot = resolve(__dirname, '../renderer')
  protocol.handle('app', async request => {
    const url = new URL(request.url)
    const file = resolve(bundleRoot, '.' + decodeURIComponent(url.pathname))
    if (url.host !== 'bundle' || !file.startsWith(bundleRoot + sep) || !['.html', '.js', '.css'].includes(extname(file))) return new Response(null, { status: 403 })
    try {
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(file)]!
      return new Response(await readFile(file), { headers: { 'Content-Type': mime } })
    } catch { return new Response(null, { status: 404 }) }
  })
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  for (const [channel, action] of [
    ['photo:choose', () => choose('photo')], ['sticker:choose', () => choose('sticker')], ['photo:save', save]
  ] as const) {
    ipcMain.handle(channel, async (event, ...args: unknown[]): Promise<Result<unknown>> => {
      if (!win || !trustedSender(event.sender.id, win.webContents.id, event.senderFrame === win.webContents.mainFrame, event.senderFrame?.url ?? '', pageUrl)) {
        return { ok: false, error: '허용되지 않은 요청입니다.' }
      }
      if (busy) return { ok: false, error: '현재 작업이 끝난 뒤 다시 시도하세요.' }
      if (channel !== 'photo:save' && args.length) return { ok: false, error: '유효하지 않은 요청입니다.' }
      if (channel === 'photo:save' && (args.length !== 1 || !validSaveRequest(args[0]))) return { ok: false, error: '유효하지 않은 저장 요청입니다.' }
      busy = true
      try { return { ok: true, value: await action(args[0] as SaveRequest) } }
      catch (error) { return { ok: false, error: error instanceof Error ? error.message : '작업에 실패했습니다.' } }
      finally { busy = false }
    })
  }
  ipcMain.handle('window:resolve-close', (event, request: unknown): Result<null> => {
    if (!win || !trustedSender(event.sender.id, win.webContents.id, event.senderFrame === win.webContents.mainFrame, event.senderFrame?.url ?? '', pageUrl)) {
      return { ok: false, error: '허용되지 않은 요청입니다.' }
    }
    if (!request || typeof request !== 'object') return { ok: false, error: '유효하지 않은 종료 요청입니다.' }
    const value = request as Record<string, unknown>
    if (Object.keys(value).length !== 2 || !pendingClose || value.requestId !== pendingClose || !['close', 'cancel'].includes(value.action as string)) {
      return { ok: false, error: '유효하지 않은 종료 요청입니다.' }
    }
    if (value.action === 'cancel') {
      pendingClose = null; quitRequested = false
      return { ok: true, value: null }
    }
    if (busy) return { ok: false, error: '작업이 끝난 뒤 닫을 수 있습니다.' }
    pendingClose = null; allowClose = true
    setImmediate(() => { if (quitRequested) app.quit(); else win?.close() })
    return { ok: true, value: null }
  })
  createWindow()
  app.on('activate', () => { if (!win) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

app.on('before-quit', event => {
  if (win && !allowClose && (photo || busy)) {
    event.preventDefault()
    quitRequested = true
    win.close()
  }
})
