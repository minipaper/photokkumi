import type { BlurRegion, Placement, StickerInstance } from './model'
import { validPlacement } from './model'
import { NEUTRAL_ADJUSTMENTS, validAdjustments, type Adjustments } from './filters'
import { MAX_TEXTS, scaleText, validTextItem, type TextItem } from './text'
import { MAX_SHAPES, SHAPE_STYLE_KEYS, validBackground, validShapeItem, type Palette, type ShapeItem, type ShapeStyle, type ThumbBackground } from './shapes'
export const MAX_INSTANCES = 200
export const MAX_DECODED_STICKER_PIXELS = 32_000_000
export const MAX_REGIONS = 50
/**
 * Draw order: photo (adjusted) → blur/mosaic regions → shapes (array order) → stickers (zOrder) → texts (array order, always on top).
 * A thumbnail scene also has a background (it replaces the photo) and the applied template/color theme.
 */
export interface Scene {
  stickers: StickerInstance[]; regions: BlurRegion[]; shapes: ShapeItem[]; texts: TextItem[]; adjust: Adjustments; selectedId: string | null
  background?: ThumbBackground
  template?: string
  /** Palette id chosen by the user; undefined = each template's own colors. */
  theme?: string
}
export interface SceneHistory { present: Scene; past: Scene[]; future: Scene[] }
export const emptyHistory = (): SceneHistory => ({ present: { stickers: [], regions: [], shapes: [], texts: [], adjust: { ...NEUTRAL_ADJUSTMENTS }, selectedId: null }, past: [], future: [] })
export function setAdjustments(scene: Scene, adjust: Adjustments): Scene {
  if (!validAdjustments(adjust)) throw new Error('보정 값은 -100~100 정수입니다.')
  return { ...scene, adjust: { ...adjust } }
}
export const validStrength = (value: number) => Number.isInteger(value) && value >= 1 && value <= 100
export function addRegion(scene: Scene, region: BlurRegion): Scene {
  if (scene.regions.length >= MAX_REGIONS) throw new Error('사진 한 장에는 블러·모자이크 영역을 최대 50개 만들 수 있습니다.')
  if (!validPlacement(region) || !validStrength(region.strength) || !['blur', 'mosaic'].includes(region.style) || !validShape(region.shape)
    || allItems(scene).some(old => old.id === region.id)) throw new Error('잘못된 블러 영역입니다.')
  return { ...scene, regions: [...scene.regions, region], selectedId: region.id }
}
const allItems = (scene: Scene) => [...scene.regions, ...scene.stickers, ...scene.shapes, ...scene.texts]
const validShape = (shape: unknown) => shape === undefined || shape === 'ellipse' || shape === 'rect'
export function updateSelectedRegion(scene: Scene, effect: Pick<BlurRegion, 'style' | 'strength' | 'shape'>): Scene {
  if (!validStrength(effect.strength) || !['blur', 'mosaic'].includes(effect.style) || !validShape(effect.shape)) throw new Error('잘못된 블러 설정입니다.')
  return { ...scene, regions: scene.regions.map(item => item.id === scene.selectedId ? { ...item, style: effect.style, strength: effect.strength, shape: effect.shape ?? item.shape } : item) }
}
const ordered = (stickers: StickerInstance[]) => stickers.map((item, index) => ({ ...item, zOrder: index }))
export function addInstance(scene: Scene, item: StickerInstance): Scene {
  if (scene.stickers.length >= MAX_INSTANCES) throw new Error('사진 한 장에는 스티커를 최대 200개 배치할 수 있습니다.')
  if (!validPlacement(item) || allItems(scene).some(old => old.id === item.id)) throw new Error('잘못된 스티커 배치입니다.')
  return { ...scene, stickers: ordered([...scene.stickers, item]), selectedId: item.id }
}
export function updateSelected(scene: Scene, placement: Placement): Scene {
  if (!validPlacement(placement)) throw new Error('잘못된 스티커 변환입니다.')
  const apply = <T extends Placement & { id: string }>(item: T): T => item.id === scene.selectedId ? { ...item, x: placement.x, y: placement.y, width: placement.width, height: placement.height, rotation: placement.rotation } : item
  return { ...scene, stickers: scene.stickers.map(apply), regions: scene.regions.map(apply), shapes: scene.shapes.map(apply), texts: scene.texts.map(item => item.id === scene.selectedId ? scaleText(item, placement) : item) }
}
export function addText(scene: Scene, item: TextItem): Scene {
  if (scene.texts.length >= MAX_TEXTS) throw new Error('사진 한 장에는 글자를 최대 50개 넣을 수 있습니다.')
  if (!validTextItem(item) || allItems(scene).some(old => old.id === item.id)) throw new Error('잘못된 글자입니다.')
  return { ...scene, texts: [...scene.texts, item], selectedId: item.id }
}
/** Replaces the selected text's content/style; the caller passes the re-measured width/height. */
export function updateSelectedText(scene: Scene, change: Pick<TextItem, 'text' | 'fontSize' | 'style' | 'width' | 'height'>): Scene {
  const current = scene.texts.find(item => item.id === scene.selectedId)
  if (!current) return scene
  // Left/right-aligned text keeps that edge in place when its box grows or shrinks (center text grows both ways).
  const grow = (change.width - current.width) / 2, side = change.style.align === 'left' ? 1 : change.style.align === 'right' ? -1 : 0
  const angle = current.rotation * Math.PI / 180
  const next: TextItem = { ...current, text: change.text, fontSize: change.fontSize, style: { ...change.style }, width: change.width, height: change.height,
    x: current.x + side * grow * Math.cos(angle), y: current.y + side * grow * Math.sin(angle) }
  next.themed = keepThemed(current.themed, key => current.style[key] === change.style[key])
  if (!validTextItem(next)) throw new Error('잘못된 글자 설정입니다.')
  return { ...scene, texts: scene.texts.map(item => item.id === current.id ? next : item) }
}
function keepThemed<K extends string, S>(themed: Partial<Record<K, S>> | undefined, unchanged: (key: K) => boolean): Partial<Record<K, S>> | undefined {
  if (!themed) return undefined
  const kept = Object.fromEntries(Object.entries(themed).filter(([key]) => unchanged(key as K))) as Partial<Record<K, S>>
  return Object.keys(kept).length ? kept : undefined
}
export function addShape(scene: Scene, item: ShapeItem): Scene {
  if (scene.shapes.length >= MAX_SHAPES) throw new Error('도형은 최대 50개까지 넣을 수 있습니다.')
  if (!validShapeItem(item) || allItems(scene).some(old => old.id === item.id)) throw new Error('잘못된 도형입니다.')
  return { ...scene, shapes: [...scene.shapes, item], selectedId: item.id }
}
/** Changes the selected shape's look; a changed fill/stroke color stops following the color theme. */
export function updateSelectedShape(scene: Scene, style: ShapeStyle): Scene {
  const current = scene.shapes.find(item => item.id === scene.selectedId)
  if (!current) return scene
  const next: ShapeItem = { ...current, ...Object.fromEntries(SHAPE_STYLE_KEYS.map(key => [key, style[key]])) }
  next.themed = keepThemed(current.themed, key => current[key] === next[key])
  if (!validShapeItem(next)) throw new Error('잘못된 도형 설정입니다.')
  return { ...scene, shapes: scene.shapes.map(item => item.id === current.id ? next : item) }
}
export function setBackground(scene: Scene, background: ThumbBackground): Scene {
  if (!validBackground(background)) throw new Error('잘못된 배경 설정입니다.')
  const colorSlot = scene.background?.colorSlot && scene.background.color === background.color ? scene.background.colorSlot : undefined
  return { ...scene, background: { ...background, colorSlot } }
}
/** Replaces the template part of a thumbnail (background look, shapes, texts); stickers and the chosen photo stay. */
export function applyLayout(scene: Scene, layout: { background: ThumbBackground; shapes: ShapeItem[]; texts: TextItem[]; template?: string }): Scene {
  if (!validBackground(layout.background) || layout.shapes.length > MAX_SHAPES || layout.texts.length > MAX_TEXTS
    || !layout.shapes.every(validShapeItem) || !layout.texts.every(validTextItem)) throw new Error('템플릿을 적용할 수 없습니다.')
  const ids = [...scene.stickers, ...layout.shapes, ...layout.texts].map(item => item.id)
  if (new Set(ids).size !== ids.length) throw new Error('템플릿을 적용할 수 없습니다.')
  return { ...scene, background: { ...layout.background }, shapes: layout.shapes, texts: layout.texts, template: layout.template, selectedId: null }
}
/** Recolors every theme-linked color with the palette's colors. */
export function applyTheme(scene: Scene, theme: Palette): Scene {
  const pick = <K extends string>(item: Record<K, unknown>, themed: Partial<Record<K, keyof Palette>> | undefined) =>
    themed ? Object.fromEntries(Object.entries(themed).map(([key, slot]) => [key, theme[slot as keyof Palette]])) as Partial<Record<K, string>> : {}
  const background = scene.background && (scene.background.colorSlot ? { ...scene.background, color: theme[scene.background.colorSlot] } : scene.background)
  return {
    ...scene, theme: theme.id, background,
    shapes: scene.shapes.map(item => ({ ...item, ...pick(item, item.themed) })),
    texts: scene.texts.map(item => ({ ...item, style: { ...item.style, ...pick(item.style, item.themed) } }))
  }
}
export function duplicateSelected(scene: Scene, id: string): Scene {
  const shape = scene.shapes.find(item => item.id === scene.selectedId)
  if (shape) return addShape(scene, { ...shape, id, x: Math.min(65536, shape.x + 20), y: Math.min(65536, shape.y + 20) })
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
  if (scene.shapes.some(item => item.id === scene.selectedId)) {
    const shapes = scene.shapes.filter(item => item.id !== scene.selectedId)
    return { ...scene, shapes, selectedId: shapes.at(-1)?.id ?? null }
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
  const shapeIndex = scene.shapes.findIndex(item => item.id === scene.selectedId), shapeNext = shapeIndex + direction
  if (shapeIndex >= 0) {
    if (shapeNext < 0 || shapeNext >= scene.shapes.length) return scene
    const shapes = [...scene.shapes]; [shapes[shapeIndex], shapes[shapeNext]] = [shapes[shapeNext], shapes[shapeIndex]]
    return { ...scene, shapes }
  }
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
