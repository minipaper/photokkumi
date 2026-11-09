import type { BlurRegion, Placement, StickerInstance } from './model'
import { validPlacement } from './model'
import { NEUTRAL_ADJUSTMENTS, validAdjustments, type Adjustments } from './filters'
export const MAX_INSTANCES = 200
export const MAX_DECODED_STICKER_PIXELS = 32_000_000
export const MAX_REGIONS = 50
export interface Scene { stickers: StickerInstance[]; regions: BlurRegion[]; adjust: Adjustments; selectedId: string | null }
export interface SceneHistory { present: Scene; past: Scene[]; future: Scene[] }
export const emptyHistory = (): SceneHistory => ({ present: { stickers: [], regions: [], adjust: { ...NEUTRAL_ADJUSTMENTS }, selectedId: null }, past: [], future: [] })
export function setAdjustments(scene: Scene, adjust: Adjustments): Scene {
  if (!validAdjustments(adjust)) throw new Error('보정 값은 -100~100 정수입니다.')
  return { ...scene, adjust: { ...adjust } }
}
export const validStrength = (value: number) => Number.isInteger(value) && value >= 1 && value <= 100
export function addRegion(scene: Scene, region: BlurRegion): Scene {
  if (scene.regions.length >= MAX_REGIONS) throw new Error('사진 한 장에는 블러·모자이크 영역을 최대 50개 만들 수 있습니다.')
  if (!validPlacement(region) || !validStrength(region.strength) || !['blur', 'mosaic'].includes(region.style)
    || [...scene.regions, ...scene.stickers].some(old => old.id === region.id)) throw new Error('잘못된 블러 영역입니다.')
  return { ...scene, regions: [...scene.regions, region], selectedId: region.id }
}
export function updateSelectedRegion(scene: Scene, effect: Pick<BlurRegion, 'style' | 'strength'>): Scene {
  if (!validStrength(effect.strength) || !['blur', 'mosaic'].includes(effect.style)) throw new Error('잘못된 블러 설정입니다.')
  return { ...scene, regions: scene.regions.map(item => item.id === scene.selectedId ? { ...item, style: effect.style, strength: effect.strength } : item) }
}
const ordered = (stickers: StickerInstance[]) => stickers.map((item, index) => ({ ...item, zOrder: index }))
export function addInstance(scene: Scene, item: StickerInstance): Scene {
  if (scene.stickers.length >= MAX_INSTANCES) throw new Error('사진 한 장에는 스티커를 최대 200개 배치할 수 있습니다.')
  if (!validPlacement(item) || scene.stickers.some(old => old.id === item.id)) throw new Error('잘못된 스티커 배치입니다.')
  return { ...scene, stickers: ordered([...scene.stickers, item]), selectedId: item.id }
}
export function updateSelected(scene: Scene, placement: Placement): Scene {
  if (!validPlacement(placement)) throw new Error('잘못된 스티커 변환입니다.')
  const apply = <T extends Placement & { id: string }>(item: T): T => item.id === scene.selectedId ? { ...item, x: placement.x, y: placement.y, width: placement.width, height: placement.height, rotation: placement.rotation } : item
  return { ...scene, stickers: scene.stickers.map(apply), regions: scene.regions.map(apply) }
}
export function duplicateSelected(scene: Scene, id: string): Scene {
  const region = scene.regions.find(item => item.id === scene.selectedId)
  if (region) return addRegion(scene, { ...region, id, x: Math.min(65536, region.x + 20), y: Math.min(65536, region.y + 20) })
  const item = scene.stickers.find(item => item.id === scene.selectedId)
  return item ? addInstance(scene, { ...item, id, x: Math.min(65536, item.x + 20), y: Math.min(65536, item.y + 20) }) : scene
}
export function removeSelected(scene: Scene): Scene {
  if (scene.regions.some(item => item.id === scene.selectedId)) {
    const regions = scene.regions.filter(item => item.id !== scene.selectedId)
    return { ...scene, regions, selectedId: regions.at(-1)?.id ?? scene.stickers.at(-1)?.id ?? null }
  }
  const stickers = ordered(scene.stickers.filter(item => item.id !== scene.selectedId))
  return { ...scene, stickers, selectedId: stickers.at(-1)?.id ?? null }
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
