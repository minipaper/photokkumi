import { app, BrowserWindow, dialog, ipcMain, nativeImage, protocol, session } from 'electron'
import { mkdirSync } from 'node:fs'
import { open, readFile } from 'node:fs/promises'
import { basename, extname, join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AssetKind, ImageAsset, Result, SaveRequest } from '../shared/model'
import { inspectImage, MAX_FILE_BYTES, MAX_OUTPUT_BYTES } from './images'
import { saveUnique, SaveCleanupError } from './files'
import { trustedSender, validSaveRequest } from './security'
import { StickerLibrary, readBounded } from './library'
import { MAX_BACKUP_BYTES, validAssetId, validMetadata } from '../shared/library'

const profile = app.commandLine.getSwitchValue('user-data-dir')
if (profile) { mkdirSync(resolve(profile), { recursive: true }); app.setPath('userData', resolve(profile)) }
const primaryInstance = app.requestSingleInstanceLock()
let activeStickerId: string | null = null
const library = new StickerLibrary(app.getPath('userData'), bytes => {
  const image = nativeImage.createFromBuffer(Buffer.from(bytes))
  if (image.isEmpty()) throw new Error('PNG를 디코딩할 수 없습니다.')
  return image.toPNG()
})
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
  if (kind === 'sticker') {
    const selected = await dialog.showOpenDialog(win, { title: 'PNG 스티커 등록', properties: ['openFile', 'multiSelections'], filters: [{ name: 'PNG', extensions: ['png'] }] })
    if (selected.canceled || !selected.filePaths[0]) return null
    const result = await library.importFiles(selected.filePaths)
    const asset = result.stickers.find(item => item.id === result.importedIds[0])!
    activeStickerId = asset.id
    return { id: asset.id, name: asset.name, width: asset.width, height: asset.height, mime: 'image/png', bytes: await library.read(asset.id) }
  }
  const result = await dialog.showOpenDialog(win, {
    title: '사진 한 장 열기',
    properties: ['openFile'],
    filters: [{ name: 'JPG / PNG', extensions: ['jpg', 'jpeg', 'png'] }]
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
  photo = { ...asset, path, bytes: new Uint8Array() }; activeStickerId = null
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
  win.on('closed', () => { win = null; photo = null; pendingClose = null; activeStickerId = null })
  void win.loadURL(pageUrl)
}

app.whenReady().then(() => {
  if (!primaryInstance) { app.quit(); return }
  // Keep a rejected load promise so a damaged manifest can never become an empty overwrite.
  const loadedLibrary = library.load()
  void loadedLibrary.catch(() => undefined)
  const bundleRoot = resolve(__dirname, '../renderer')
  const thumbnails = new Map<string, Buffer>()
  let thumbnailWork = Promise.resolve()
  protocol.handle('app', async request => {
    const url = new URL(request.url)
    const thumbnail = /^\/stickers\/([0-9a-f-]+)\.png$/.exec(url.pathname)
    if (url.host === 'bundle' && thumbnail && validAssetId(thumbnail[1])) {
      const task = thumbnailWork.then(async () => {
        try {
          await loadedLibrary
          const id = thumbnail[1]
          if (!library.list().some(item => item.id === id)) return new Response(null, { status: 404 })
          let png = thumbnails.get(id)
          if (!png) {
            const bytes = await library.read(id)
            const image = nativeImage.createFromBuffer(bytes)
            if (image.isEmpty()) throw new Error('PNG decode failed')
            const size = image.getSize(), factor = Math.min(1, 160 / size.width, 160 / size.height)
            png = image.resize({ width: Math.max(1, Math.round(size.width * factor)), height: Math.max(1, Math.round(size.height * factor)) }).toPNG()
            if (thumbnails.size >= 100) thumbnails.delete(thumbnails.keys().next().value!)
            thumbnails.set(id, png)
          }
          return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' } })
        } catch { return new Response(null, { status: 404 }) }
      })
      thumbnailWork = task.then(() => undefined, () => undefined)
      return task
    }
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
      try { if (channel === 'sticker:choose') await loadedLibrary; return { ok: true, value: await action(args[0] as SaveRequest) } }
      catch (error) { return { ok: false, error: error instanceof Error ? error.message : '작업에 실패했습니다.' } }
      finally { busy = false }
    })
  }
  const libraryActions: Record<string, (...args: unknown[]) => Promise<unknown>> = {
    'library:list': async () => library.list(),
    'library:import': async () => {
      const selected = await dialog.showOpenDialog(win!, { title: 'PNG 스티커 등록', properties: ['openFile', 'multiSelections'], filters: [{ name: 'PNG', extensions: ['png'] }] })
      return selected.canceled ? null : library.importFiles(selected.filePaths)
    },
    'library:use': async id => {
      if (!photo) throw new Error('사진을 먼저 열어주세요.')
      const bytes = await library.read(id as string)
      const asset = library.list().find(item => item.id === id)!
      const result: ImageAsset = { id: asset.id, name: asset.name, width: asset.width, height: asset.height, mime: 'image/png', bytes }
      activeStickerId = asset.id
      return result
    },
    'library:update': async (id, metadata) => library.update(id as string, metadata as import('../shared/library').StickerMetadata),
    'library:delete': async id => library.remove(id as string, activeStickerId),
    'library:backup': async () => {
      const bytes = await library.backup()
      const selected = await dialog.showOpenDialog(win!, { title: '라이브러리 백업 폴더', properties: ['openDirectory', 'createDirectory'] })
      if (selected.canceled || !selected.filePaths[0]) return null
      return basename(await saveUnique(selected.filePaths[0], 'PhotoKkumi-library', bytes, '.zip'))
    },
    'library:restore': async () => {
      const selected = await dialog.showOpenDialog(win!, { title: '라이브러리 ZIP 복원', properties: ['openFile'], filters: [{ name: 'ZIP', extensions: ['zip'] }] })
      if (selected.canceled || !selected.filePaths[0]) return null
      return library.restore(await readBounded(selected.filePaths[0], MAX_BACKUP_BYTES))
    }
  }
  for (const [channel, action] of Object.entries(libraryActions)) {
    ipcMain.handle(channel, async (event, ...args: unknown[]): Promise<Result<unknown>> => {
      if (!win || !trustedSender(event.sender.id, win.webContents.id, event.senderFrame === win.webContents.mainFrame, event.senderFrame?.url ?? '', pageUrl)) return { ok: false, error: '허용되지 않은 요청입니다.' }
      const count = channel === 'library:update' ? 2 : ['library:use', 'library:delete'].includes(channel) ? 1 : 0
      if (args.length !== count || (count > 0 && !validAssetId(args[0])) || (count === 2 && !validMetadata(args[1]))) return { ok: false, error: '유효하지 않은 라이브러리 요청입니다.' }
      if (busy) return { ok: false, error: '현재 작업이 끝난 뒤 다시 시도하세요.' }
      busy = true
      try { await loadedLibrary; return { ok: true, value: await action(...args) } }
      catch (error) { return { ok: false, error: error instanceof Error ? error.message : '라이브러리 작업에 실패했습니다.' } }
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

app.on('second-instance', () => { win?.restore(); win?.focus() })
