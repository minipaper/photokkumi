import { app, BrowserWindow, dialog, ipcMain, nativeImage, protocol, session } from 'electron'
import { mkdirSync } from 'node:fs'
import { readFile, realpath, stat } from 'node:fs/promises'
import { basename, extname, join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ImageAsset, Result, SaveRequest, SaveReceipt } from '../shared/model'
import { imageSize } from 'image-size'
import { orientThumbnail } from '../shared/thumbnail'
import { inspectImage, MAX_OUTPUT_BYTES } from './images'
import { saveUnique, SaveCleanupError } from './files'
import { trustedSender, validSaveRequest } from './security'
import { StickerLibrary, readBounded } from './library'
import { OutputStore } from './settings'
import { outputSize, validOutput } from '../shared/output'
import { PhotoStore, validDroppedPaths } from './photos'
import { MAX_BACKUP_BYTES, validAssetId, validMetadata } from '../shared/library'

const profile = app.commandLine.getSwitchValue('user-data-dir')
if (profile) { mkdirSync(resolve(profile), { recursive: true }); app.setPath('userData', resolve(profile)) }
const primaryInstance = app.requestSingleInstanceLock()
let activeStickerIds = new Set<string>()
const permittedStickerIds = new Set<string>()
const library = new StickerLibrary(app.getPath('userData'), bytes => {
  const image = nativeImage.createFromBuffer(Buffer.from(bytes))
  if (image.isEmpty()) throw new Error('PNG를 디코딩할 수 없습니다.')
  return image.toPNG()
})
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }])
app.enableSandbox()
let win: BrowserWindow | null = null
const photos = new PhotoStore(bytes => {
  const image = nativeImage.createFromBuffer(bytes)
  if (image.isEmpty()) throw new Error('이미지를 디코딩할 수 없습니다.')
  const size = image.getSize(), scale = Math.min(1, 120 / size.width, 120 / size.height)
  const small = image.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) })
  const dimensions = small.getSize()
  const oriented = orientThumbnail(small.toBitmap(), dimensions.width, dimensions.height, imageSize(bytes).orientation ?? 1)
  return nativeImage.createFromBitmap(Buffer.from(oriented.bytes), { width: oriented.width, height: oriented.height }).toDataURL()
})
const outputStore = new OutputStore(app.getPath('userData'))
const photoReferences = new Map<string, string[]>()
let outputDirectory: string | null = null
let busy = false
let settingsPending = 0
let pendingClose: string | null = null
let allowClose = false
let quitRequested = false
const developmentUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
const pageUrl = developmentUrl ? new URL(developmentUrl).href : 'app://bundle/index.html'

async function choosePhotos() {
  const result = await dialog.showOpenDialog(win!, { title: '사진 열기', properties: ['openFile', 'multiSelections'], filters: [{ name: 'JPG / PNG', extensions: ['jpg', 'jpeg', 'png'] }] })
  return result.canceled || !result.filePaths.length ? null : photos.add(result.filePaths)
}

async function choosePhotoFolder() {
  const selected = await dialog.showOpenDialog(win!, { title: '입력 폴더 선택', properties: ['openDirectory'] })
  if (selected.canceled || !selected.filePaths[0]) return null
  return photos.addFolder(selected.filePaths[0])
}
async function chooseOutputFolder(): Promise<string | null> {
  const selected = await dialog.showOpenDialog(win!, { title: '출력 폴더 선택', properties: ['openDirectory', 'createDirectory'] })
  if (selected.canceled || !selected.filePaths[0]) return null
  const path = await realpath(selected.filePaths[0])
  if (!(await stat(path)).isDirectory()) throw new Error('출력 폴더를 확인하세요.')
  outputDirectory = path
  return path
}

async function removePhoto(id: string) {
  const remaining = photos.remove(id)
  photoReferences.delete(id)
  activeStickerIds = new Set([...photoReferences.values()].flat())
  return remaining
}

async function save(request: SaveRequest): Promise<SaveReceipt | null> {
  if (!validSaveRequest(request)) throw new Error('유효하지 않은 저장 요청입니다.')
  const record = photos.get(request.photoId), photo = record.info
  if (request.png.byteLength > MAX_OUTPUT_BYTES) throw new Error('저장 이미지가 너무 큽니다.')
  const info = inspectImage(request.png, 'photo', true)
  const expected = outputSize(photo.width, photo.height, request.output)
  if (info.width !== expected.width || info.height !== expected.height) throw new Error('출력 크기가 설정과 다릅니다.')
  const decoded = nativeImage.createFromBuffer(Buffer.from(request.png))
  if (decoded.isEmpty()) throw new Error('저장 이미지가 손상되었습니다.')
  const size = decoded.getSize()
  if (size.width !== expected.width || size.height !== expected.height) throw new Error('출력 이미지 크기를 확인할 수 없습니다.')
  if (request.output.format === 'jpg') {
    const pixels = decoded.toBitmap()
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] !== 255) throw new Error('JPG는 흰색 배경에 합성해야 합니다.')
  }
  // Re-encode decoded pixels; do not copy any incoming PNG/EXIF/GPS metadata.
  const encoded = request.output.format === 'jpg' ? decoded.toJPEG(request.output.quality) : decoded.toPNG()
  if (!encoded.length || encoded.length > MAX_OUTPUT_BYTES) throw new Error('저장 이미지가 너무 큽니다.')
  let directory = outputDirectory
  if (!directory) {
    const selected = await dialog.showOpenDialog(win!, { title: '결과를 저장할 폴더', properties: ['openDirectory', 'createDirectory'] })
    if (selected.canceled || !selected.filePaths[0]) return null
    directory = selected.filePaths[0]
  }
  try {
    const target = await realpath(directory)
    const name = basename(await saveUnique(target, record.path, encoded, request.output.format === 'jpg' ? '.jpg' : '.png'))
    outputDirectory = target
    return { name, folderLabel: target }
  }
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
    if (allowClose || (!photos.list().length && !busy && !settingsPending)) return
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
  win.on('closed', () => { win = null; outputDirectory = null; photos.clear(); photoReferences.clear(); pendingClose = null; activeStickerIds.clear(); permittedStickerIds.clear() })
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
    ['photo:choose', choosePhotos], ['photo:folder', choosePhotoFolder], ['output:folder', chooseOutputFolder], ['photo:save', save], ['photo:read', (id: string) => photos.read(id)],
    ['photo:drop', (paths: string[]) => photos.addDropped(paths)], ['photo:remove', removePhoto]
  ] as const) {
    ipcMain.handle(channel, async (event, ...args: unknown[]): Promise<Result<unknown>> => {
      if (!win || !trustedSender(event.sender.id, win.webContents.id, event.senderFrame === win.webContents.mainFrame, event.senderFrame?.url ?? '', pageUrl)) {
        return { ok: false, error: '허용되지 않은 요청입니다.' }
      }
      if (busy) return { ok: false, error: '현재 작업이 끝난 뒤 다시 시도하세요.' }
      if (!['photo:save', 'photo:read', 'photo:drop', 'photo:remove'].includes(channel) && args.length) return { ok: false, error: '유효하지 않은 요청입니다.' }
      if (channel === 'photo:save' && (args.length !== 1 || !validSaveRequest(args[0]))) return { ok: false, error: '유효하지 않은 저장 요청입니다.' }
      if (channel === 'photo:drop' && (args.length !== 1 || !validDroppedPaths(args[0]))) return { ok: false, error: '끌어 놓은 항목을 확인할 수 없습니다.' }
      if ((channel === 'photo:read' || channel === 'photo:remove') && (args.length !== 1 || !validAssetId(args[0]))) return { ok: false, error: '유효하지 않은 사진 요청입니다.' }
      busy = true
      try { return { ok: true, value: await (action as (value: unknown) => Promise<unknown>)(args[0]) } }
      catch (error) { return { ok: false, error: error instanceof Error ? error.message : '작업에 실패했습니다.' } }
      finally { busy = false }
    })
  }
  for (const channel of ['output:get', 'output:update']) {
    ipcMain.handle(channel, async (event, ...args: unknown[]): Promise<Result<unknown>> => {
      if (!win || !trustedSender(event.sender.id, win.webContents.id, event.senderFrame === win.webContents.mainFrame, event.senderFrame?.url ?? '', pageUrl)) return { ok: false, error: '허용되지 않은 요청입니다.' }
      if ((channel === 'output:get' && args.length) || (channel === 'output:update' && (args.length !== 1 || !validOutput(args[0])))) return { ok: false, error: '잘못된 출력 설정입니다.' }
      settingsPending++
      try { return { ok: true, value: channel === 'output:get' ? await outputStore.get() : await outputStore.set(args[0] as import('../shared/output').OutputSettings) } }
      catch { return { ok: false, error: '출력 설정을 읽거나 저장하지 못했습니다. 기존 설정 파일은 보존합니다.' } }
      finally { settingsPending-- }
    })
  }
  const libraryActions: Record<string, (...args: unknown[]) => Promise<unknown>> = {
    'library:list': async () => library.list(),
    'library:import': async () => {
      const selected = await dialog.showOpenDialog(win!, { title: 'PNG 스티커 등록', properties: ['openFile', 'multiSelections'], filters: [{ name: 'PNG', extensions: ['png'] }] })
      return selected.canceled ? null : library.importFiles(selected.filePaths)
    },
    'library:use': async id => {
      if (!photos.list().length) throw new Error('사진을 먼저 열어주세요.')
      const bytes = await library.read(id as string)
      const asset = library.list().find(item => item.id === id)!
      const result: ImageAsset = { id: asset.id, name: asset.name, width: asset.width, height: asset.height, mime: 'image/png', bytes }
      activeStickerIds.add(asset.id); permittedStickerIds.add(asset.id)
      return result
    },
    'library:update': async (id, metadata) => library.update(id as string, metadata as import('../shared/library').StickerMetadata),
    'library:delete': async id => { const items = await library.remove(id as string, [...activeStickerIds]); permittedStickerIds.delete(id as string); return items },
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
  ipcMain.handle('editor:references', (event, photoId: unknown, ids: unknown): Result<null> => {
    if (!win || !trustedSender(event.sender.id, win.webContents.id, event.senderFrame === win.webContents.mainFrame, event.senderFrame?.url ?? '', pageUrl)) return { ok: false, error: '허용되지 않은 요청입니다.' }
    if (typeof photoId !== 'string' || !photos.list().some(item => item.id === photoId) || !Array.isArray(ids) || ids.length > 100 || new Set(ids).size !== ids.length
      || !ids.every(id => validAssetId(id) && permittedStickerIds.has(id))) return { ok: false, error: '잘못된 스티커 참조입니다.' }
    photoReferences.set(photoId, ids)
    activeStickerIds = new Set([...photoReferences.values()].flat())
    return { ok: true, value: null }
  })
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
    if (busy || settingsPending) return { ok: false, error: '작업이 끝난 뒤 닫을 수 있습니다.' }
    pendingClose = null; allowClose = true
    setImmediate(() => { if (quitRequested) app.quit(); else win?.close() })
    return { ok: true, value: null }
  })
  createWindow()
  app.on('activate', () => { if (!win) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

app.on('before-quit', event => {
  if (win && !allowClose && (photos.list().length || busy || settingsPending)) {
    event.preventDefault()
    quitRequested = true
    win.close()
  }
})

app.on('second-instance', () => { win?.restore(); win?.focus() })
