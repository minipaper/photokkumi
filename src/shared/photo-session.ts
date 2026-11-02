import { emptyHistory, referencedAssets, type Scene, type SceneHistory } from './scene'
export interface PhotoSession { history: SceneHistory; checkpoint: Scene; dirty: boolean; saved: boolean; outputKey: string | null; savedFolder: string | null }
export function createPhotoSession(): PhotoSession {
  const history = emptyHistory()
  return { history, checkpoint: history.present, dirty: false, saved: false, outputKey: null, savedFolder: null }
}
export function editPhotoSession(session: PhotoSession, history: SceneHistory): PhotoSession {
  return { ...session, history, dirty: true }
}
export function savePhotoSession(session: PhotoSession, outputKey: string | null = null, savedFolder: string | null = null): PhotoSession {
  return { ...session, checkpoint: session.history.present, dirty: false, saved: true, outputKey, savedFolder }
}
export function discardPhotoSession(session: PhotoSession): PhotoSession {
  return { ...session, history: { present: session.checkpoint, past: [], future: [] }, dirty: false }
}
export function sessionAssets(session: PhotoSession): string[] {
  return [...new Set([...referencedAssets(session.history), ...session.checkpoint.stickers.map(item => item.assetId)])]
}
