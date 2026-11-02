import type { Placement, StickerInstance } from './model'
import { validPlacement } from './model'
export const MAX_INSTANCES = 200
export const MAX_DECODED_STICKER_PIXELS = 32_000_000
export interface Scene { stickers: StickerInstance[]; selectedId: string | null }
export interface SceneHistory { present: Scene; past: Scene[]; future: Scene[] }
export const emptyHistory = (): SceneHistory => ({ present: { stickers: [], selectedId: null }, past: [], future: [] })
const ordered = (stickers: StickerInstance[]) => stickers.map((item, index) => ({ ...item, zOrder: index }))
export function addInstance(scene: Scene, item: StickerInstance): Scene {
  if (scene.stickers.length >= MAX_INSTANCES) throw new Error('사진 한 장에는 스티커를 최대 200개 배치할 수 있습니다.')
  if (!validPlacement(item) || scene.stickers.some(old => old.id === item.id)) throw new Error('잘못된 스티커 배치입니다.')
  return { stickers: ordered([...scene.stickers, item]), selectedId: item.id }
}
export function updateSelected(scene: Scene, placement: Placement): Scene {
  if (!validPlacement(placement)) throw new Error('잘못된 스티커 변환입니다.')
  return { ...scene, stickers: scene.stickers.map(item => item.id === scene.selectedId ? { ...item, x: placement.x, y: placement.y, width: placement.width, height: placement.height, rotation: placement.rotation } : item) }
}
export function duplicateSelected(scene: Scene, id: string): Scene {
  const item = scene.stickers.find(item => item.id === scene.selectedId)
  return item ? addInstance(scene, { ...item, id, x: Math.min(65536, item.x + 20), y: Math.min(65536, item.y + 20) }) : scene
}
export function removeSelected(scene: Scene): Scene {
  const stickers = ordered(scene.stickers.filter(item => item.id !== scene.selectedId))
  return { stickers, selectedId: stickers.at(-1)?.id ?? null }
}
export function reorderSelected(scene: Scene, direction: -1 | 1): Scene {
  const index = scene.stickers.findIndex(item => item.id === scene.selectedId), next = index + direction
  if (index < 0 || next < 0 || next >= scene.stickers.length) return scene
  const stickers = [...scene.stickers]; [stickers[index], stickers[next]] = [stickers[next], stickers[index]]
  return { ...scene, stickers: ordered(stickers) }
}
export function commitScene(history: SceneHistory, scene: Scene): SceneHistory {
  if (scene === history.present) return history
  return { present: scene, past: [...history.past, history.present].slice(-50), future: [] }
}
export function undoScene(history: SceneHistory): SceneHistory {
  const previous = history.past.at(-1)
  return previous ? { present: previous, past: history.past.slice(0, -1), future: [history.present, ...history.future] } : history
}
export function redoScene(history: SceneHistory): SceneHistory {
  const next = history.future[0]
  return next ? { present: next, past: [...history.past, history.present].slice(-50), future: history.future.slice(1) } : history
}
export function referencedAssets(history: SceneHistory): string[] {
  return [...new Set([...history.past, history.present, ...history.future].flatMap(scene => scene.stickers.map(item => item.assetId)))]
}
