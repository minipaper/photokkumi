import type { BlurRegion, Placement, StickerInstance } from './model'
import { validPlacement } from './model'
import { NEUTRAL_ADJUSTMENTS, validAdjustments, type Adjustments } from './filters'
import { MAX_TEXTS, scaleText, validTextItem, type TextItem } from './text'
export const MAX_INSTANCES = 200
export const MAX_DECODED_STICKER_PIXELS = 32_000_000
export const MAX_REGIONS = 50
/** Draw order: photo (adjusted) → blur/mosaic regions → stickers (zOrder) → texts (array order, always on top). */
export interface Scene { stickers: StickerInstance[]; regions: BlurRegion[]; texts: TextItem[]; adjust: Adjustments; selectedId: string | null }
export interface SceneHistory { present: Scene; past: Scene[]; future: Scene[] }
export const emptyHistory = (): SceneHistory => ({ present: { stickers: [], regions: [], texts: [], adjust: { ...NEUTRAL_ADJUSTMENTS }, selectedId: null }, past: [], future: [] })
export function setAdjustments(scene: Scene, adjust: Adjustments): Scene {
  if (!validAdjustments(adjust)) throw new Error('보정 값은 -100~100 정수입니다.')
  return { ...scene, adjust: { ...adjust } }
}
export const validStrength = (value: number) => Number.isInteger(value) && value >= 1 && value <= 100
export function addRegion(scene: Scene, region: BlurRegion): Scene {
  if (scene.regions.length >= MAX_REGIONS) throw new Error('사진 한 장에는 블러·모자이크 영역을 최대 50개 만들 수 있습니다.')
  if (!validPlacement(region) || !validStrength(region.strength) || !['blur', 'mosaic'].includes(region.style) || !validShape(region.shape)
    || [...scene.regions, ...scene.stickers, ...scene.texts].some(old => old.id === region.id)) throw new Error('잘못된 블러 영역입니다.')
  return { ...scene, regions: [...scene.regions, region], selectedId: region.id }
}
const validShape = (shape: unknown) => shape === undefined || shape === 'ellipse' || shape === 'rect'
export function updateSelectedRegion(scene: Scene, effect: Pick<BlurRegion, 'style' | 'strength' | 'shape'>): Scene {
  if (!validStrength(effect.strength) || !['blur', 'mosaic'].includes(effect.style) || !validShape(effect.shape)) throw new Error('잘못된 블러 설정입니다.')
  return { ...scene, regions: scene.regions.map(item => item.id === scene.selectedId ? { ...item, style: effect.style, strength: effect.strength, shape: effect.shape ?? item.shape } : item) }
}
const ordered = (stickers: StickerInstance[]) => stickers.map((item, index) => ({ ...item, zOrder: index }))
export function addInstance(scene: Scene, item: StickerInstance): Scene {
  if (scene.stickers.length >= MAX_INSTANCES) throw new Error('사진 한 장에는 스티커를 최대 200개 배치할 수 있습니다.')
  if (!validPlacement(item) || [...scene.regions, ...scene.stickers, ...scene.texts].some(old => old.id === item.id)) throw new Error('잘못된 스티커 배치입니다.')
  return { ...scene, stickers: ordered([...scene.stickers, item]), selectedId: item.id }
}
export function updateSelected(scene: Scene, placement: Placement): Scene {
  if (!validPlacement(placement)) throw new Error('잘못된 스티커 변환입니다.')
  const apply = <T extends Placement & { id: string }>(item: T): T => item.id === scene.selectedId ? { ...item, x: placement.x, y: placement.y, width: placement.width, height: placement.height, rotation: placement.rotation } : item
  return { ...scene, stickers: scene.stickers.map(apply), regions: scene.regions.map(apply), texts: scene.texts.map(item => item.id === scene.selectedId ? scaleText(item, placement) : item) }
}
export function addText(scene: Scene, item: TextItem): Scene {
  if (scene.texts.length >= MAX_TEXTS) throw new Error('사진 한 장에는 글자를 최대 50개 넣을 수 있습니다.')
  if (!validTextItem(item) || [...scene.regions, ...scene.stickers, ...scene.texts].some(old => old.id === item.id)) throw new Error('잘못된 글자입니다.')
  return { ...scene, texts: [...scene.texts, item], selectedId: item.id }
}
/** Replaces the selected text's content/style; the caller passes the re-measured width/height. */
export function updateSelectedText(scene: Scene, change: Pick<TextItem, 'text' | 'fontSize' | 'style' | 'width' | 'height'>): Scene {
  const current = scene.texts.find(item => item.id === scene.selectedId)
  if (!current) return scene
  const next = { ...current, text: change.text, fontSize: change.fontSize, style: { ...change.style }, width: change.width, height: change.height }
  if (!validTextItem(next)) throw new Error('잘못된 글자 설정입니다.')
  return { ...scene, texts: scene.texts.map(item => item.id === current.id ? next : item) }
}
export function duplicateSelected(scene: Scene, id: string): Scene {
  const text = scene.texts.find(item => item.id === scene.selectedId)
  if (text) return addText(scene, { ...text, id, x: Math.min(65536, text.x + 20), y: Math.min(65536, text.y + 20) })
  const region = scene.regions.find(item => item.id === scene.selectedId)
  if (region) return addRegion(scene, { ...region, id, x: Math.min(65536, region.x + 20), y: Math.min(65536, region.y + 20) })
  const item = scene.stickers.find(item => item.id === scene.selectedId)
  return item ? addInstance(scene, { ...item, id, x: Math.min(65536, item.x + 20), y: Math.min(65536, item.y + 20) }) : scene
}
export function removeSelected(scene: Scene): Scene {
  if (scene.texts.some(item => item.id === scene.selectedId)) {
    const texts = scene.texts.filter(item => item.id !== scene.selectedId)
    return { ...scene, texts, selectedId: texts.at(-1)?.id ?? null }
  }
  if (scene.regions.some(item => item.id === scene.selectedId)) {
    const regions = scene.regions.filter(item => item.id !== scene.selectedId)
    // Stay on the same layer: the region tool and the sticker tool each select their own items.
    return { ...scene, regions, selectedId: regions.at(-1)?.id ?? null }
  }
  const stickers = ordered(scene.stickers.filter(item => item.id !== scene.selectedId))
  return { ...scene, stickers, selectedId: stickers.at(-1)?.id ?? null }
}
/** Removes every text of the photo as one undoable step. */
export function clearTexts(scene: Scene): Scene {
  return { ...scene, texts: [], selectedId: scene.texts.some(item => item.id === scene.selectedId) ? null : scene.selectedId }
}
/** Removes every blur/mosaic region of the photo as one undoable step. */
export function clearRegions(scene: Scene): Scene {
  return { ...scene, regions: [], selectedId: scene.regions.some(item => item.id === scene.selectedId) ? null : scene.selectedId }
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
