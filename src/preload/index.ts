import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { PhotoApi } from '../shared/model'
import { validUpdateState } from '../shared/update'
let closeCallback: ((requestId: string) => void) | null = null
let queuedClose: string | null = null
ipcRenderer.on('window:close-requested', (_event, requestId: unknown) => {
  if (typeof requestId !== 'string' || requestId.length !== 36) return
  if (closeCallback) closeCallback(requestId)
  else queuedClose = requestId
})
const droppedPaths = (files: File[]) => Array.from(files).slice(0, 200).map(file => { try { return webUtils.getPathForFile(file) } catch { return '' } }).filter(Boolean)
const api: PhotoApi = {
  onCloseRequested: callback => {
    closeCallback = callback
    if (queuedClose) { callback(queuedClose); queuedClose = null }
    return () => { if (closeCallback === callback) closeCallback = null }
  },
  resolveClose: request => ipcRenderer.invoke('window:resolve-close', request),
  listStickers: () => ipcRenderer.invoke('library:list'),
  importStickers: () => ipcRenderer.invoke('library:import'),
  setStickerReferences: (photoId, assetIds) => ipcRenderer.invoke('editor:references', photoId, assetIds),
  useSticker: id => ipcRenderer.invoke('library:use', id),
  updateSticker: (id, metadata) => ipcRenderer.invoke('library:update', id, metadata),
  deleteSticker: id => ipcRenderer.invoke('library:delete', id),
  backupLibrary: () => ipcRenderer.invoke('library:backup'),
  restoreLibrary: () => ipcRenderer.invoke('library:restore'),
  choosePhotos: () => ipcRenderer.invoke('photo:choose'),
  readPhoto: id => ipcRenderer.invoke('photo:read', id),
  choosePhotoFolder: () => ipcRenderer.invoke('photo:folder'),
  // Only OS-backed File objects from a real drop resolve to a path; the renderer never sees or sends raw paths.
  importDroppedFiles: files => {
    const paths = droppedPaths(files)
    return paths.length ? ipcRenderer.invoke('photo:drop', paths) : Promise.resolve({ ok: false, error: '끌어 놓은 항목에서 파일을 찾지 못했습니다.' })
  },
  importDroppedStickers: files => {
    const paths = droppedPaths(files)
    return paths.length ? ipcRenderer.invoke('library:drop', paths) : Promise.resolve({ ok: false, error: '끌어 놓은 항목에서 파일을 찾지 못했습니다.' })
  },
  removePhoto: id => ipcRenderer.invoke('photo:remove', id),
  getUpdateState: () => ipcRenderer.invoke('update:get'),
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateState: callback => {
    const listener = (_event: unknown, state: unknown) => { if (validUpdateState(state)) callback(state) }
    ipcRenderer.on('update:state', listener)
    return () => { ipcRenderer.removeListener('update:state', listener) }
  },
  gifToolStatus: () => ipcRenderer.invoke('gif:tool-status'),
  locateGifTool: () => ipcRenderer.invoke('gif:tool-locate'),
  chooseGifTool: () => ipcRenderer.invoke('gif:tool-choose'),
  openVideo: () => ipcRenderer.invoke('gif:open-video'),
  loadVideo: id => ipcRenderer.invoke('gif:load-video', id),
  createGif: (id, options) => ipcRenderer.invoke('gif:create', id, options),
  cancelGif: () => ipcRenderer.invoke('gif:cancel'),
  onGifProgress: callback => {
    const listener = (_event: unknown, ratio: unknown) => { if (typeof ratio === 'number' && ratio >= 0 && ratio <= 1) callback(ratio) }
    ipcRenderer.on('gif:progress', listener)
    return () => { ipcRenderer.removeListener('gif:progress', listener) }
  },
  chooseOutputFolder: () => ipcRenderer.invoke('output:folder'),
  getOutputFolder: () => ipcRenderer.invoke('output:current'),
  getOutputSettings: () => ipcRenderer.invoke('output:get'),
  updateOutputSettings: output => ipcRenderer.invoke('output:update', output),
  saveImage: (request) => ipcRenderer.invoke('photo:save', request)
}
contextBridge.exposeInMainWorld('photokkumi', api)
