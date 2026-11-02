import { emptyHistory, referencedAssets, type Scene, type SceneHistory } from './scene'
export interface PhotoSession { history: SceneHistory; checkpoint: Scene; dirty: boolean; saved: boolean }
export function createPhotoSession(): PhotoSession {
  const history = emptyHistory()
  return { history, checkpoint: history.present, dirty: false, saved: false }
}
export function editPhotoSession(session: PhotoSession, history: SceneHistory): PhotoSession {
  return { ...session, history, dirty: true }
}
export function savePhotoSession(session: PhotoSession): PhotoSession {
  return { ...session, checkpoint: session.history.present, dirty: false, saved: true }
}
export function discardPhotoSession(session: PhotoSession): PhotoSession {
  return { ...session, history: { present: session.checkpoint, past: [], future: [] }, dirty: false }
}
export function sessionAssets(session: PhotoSession): string[] {
  return [...new Set([...referencedAssets(session.history), ...session.checkpoint.stickers.map(item => item.assetId)])]
}
