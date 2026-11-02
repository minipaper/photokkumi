import { contextBridge, ipcRenderer } from 'electron'
import type { PhotoApi } from '../shared/model'
let closeCallback: ((requestId: string) => void) | null = null
let queuedClose: string | null = null
ipcRenderer.on('window:close-requested', (_event, requestId: unknown) => {
  if (typeof requestId !== 'string' || requestId.length !== 36) return
  if (closeCallback) closeCallback(requestId)
  else queuedClose = requestId
})
const api: PhotoApi = {
  onCloseRequested: callback => {
    closeCallback = callback
    if (queuedClose) { callback(queuedClose); queuedClose = null }
    return () => { if (closeCallback === callback) closeCallback = null }
  },
  resolveClose: request => ipcRenderer.invoke('window:resolve-close', request),
  listStickers: () => ipcRenderer.invoke('library:list'),
  importStickers: () => ipcRenderer.invoke('library:import'),
  useSticker: id => ipcRenderer.invoke('library:use', id),
  updateSticker: (id, metadata) => ipcRenderer.invoke('library:update', id, metadata),
  deleteSticker: id => ipcRenderer.invoke('library:delete', id),
  backupLibrary: () => ipcRenderer.invoke('library:backup'),
  restoreLibrary: () => ipcRenderer.invoke('library:restore'),
  choosePhoto: () => ipcRenderer.invoke('photo:choose'),
  chooseSticker: () => ipcRenderer.invoke('sticker:choose'),
  savePng: (request) => ipcRenderer.invoke('photo:save', request)
}
contextBridge.exposeInMainWorld('photokkumi', api)
