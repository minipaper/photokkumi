/**
 * Crop: the part of the photo that is saved. Stored per photo in the scene as a rectangle in original (EXIF-rotated) pixels;
 * the photo itself and every sticker/region/text keep their original coordinates, so a crop can always be widened again.
 */
export interface CropRect { x: number; y: number; width: number; height: number }
export type CropAspect = 'free' | 'original' | '1:1' | '4:3' | '3:4' | '3:2' | '2:3' | '16:9' | '9:16' | '5:4' | '4:5'
export interface Crop extends CropRect { aspect: CropAspect }
interface Size { width: number; height: number }
/** Preset buttons, landscape spelling; the 가로/세로 toggle turns 4:3 into 3:4 and so on. */
export const CROP_PRESETS: readonly CropAspect[] = ['free', 'original', '1:1', '4:3', '3:2', '16:9', '5:4']
const ASPECTS: readonly CropAspect[] = ['free', 'original', '1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16', '5:4', '4:5']
const FLIP: Partial<Record<CropAspect, CropAspect>> = { '4:3': '3:4', '3:4': '4:3', '3:2': '2:3', '2:3': '3:2', '16:9': '9:16', '9:16': '16:9', '5:4': '4:5', '4:5': '5:4' }
export const CROP_LABELS: Record<CropAspect, { name: string; use: string }> = {
  free: { name: '자유', use: '비율 없음' }, original: { name: '원본', use: '그대로' }, '1:1': { name: '1:1', use: '정사각형' },
  '4:3': { name: '4:3', use: '일반 사진' }, '3:4': { name: '3:4', use: '세로 사진' },
  '3:2': { name: '3:2', use: 'DSLR' }, '2:3': { name: '2:3', use: 'DSLR' },
  '16:9': { name: '16:9', use: '와이드' }, '9:16': { name: '9:16', use: '세로 영상' },
  '5:4': { name: '5:4', use: '인화' }, '4:5': { name: '4:5', use: '인스타' }
}
/** Smallest crop side in pixels (or the photo side when the photo is smaller). */
export const MIN_CROP = 16
/** Only ratios like 4:3 have a portrait twin. */
export const hasOrientation = (aspect: CropAspect) => !!FLIP[aspect]
export const isPortraitAspect = (aspect: CropAspect) => { const ratio = /^(\d+):(\d+)$/.exec(aspect); return !!ratio && Number(ratio[1]) < Number(ratio[2]) }
/** The preset in the requested orientation (4:3 + portrait → 3:4); others stay as they are. */
export function orient(aspect: CropAspect, portrait: boolean): CropAspect {
  return hasOrientation(aspect) && isPortraitAspect(aspect) !== portrait ? FLIP[aspect]! : aspect
}
/** width / height, or null for a free crop. */
export function aspectRatio(aspect: CropAspect, photo: Size): number | null {
  if (aspect === 'free') return null
  if (aspect === 'original') return photo.width / photo.height
  const [w, h] = aspect.split(':').map(Number)
  return w / h
}
const minSide = (photo: Size) => Math.min(MIN_CROP, photo.width, photo.height)
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
/** Largest rectangle of the aspect, centered in the photo. */
export function centeredCrop(photo: Size, aspect: CropAspect): Crop {
  const ratio = aspectRatio(aspect, photo)
  if (!ratio) return { x: 0, y: 0, width: photo.width, height: photo.height, aspect }
  let width = photo.width, height = Math.round(width / ratio)
  if (height > photo.height) { height = photo.height; width = Math.min(photo.width, Math.round(height * ratio)) }
  return { x: Math.floor((photo.width - width) / 2), y: Math.floor((photo.height - height) / 2), width, height, aspect }
}
export const fullCrop = (photo: Size): Crop => ({ x: 0, y: 0, width: photo.width, height: photo.height, aspect: 'free' })
/** The saved area: the crop, or the whole photo. */
export const cropArea = (crop: CropRect | undefined, photo: Size): CropRect => crop ? { x: crop.x, y: crop.y, width: crop.width, height: crop.height } : { x: 0, y: 0, width: photo.width, height: photo.height }
export function validCropRect(value: unknown, photo: Size): value is CropRect {
  const v = value as Record<string, unknown> | null
  const int = (key: string) => typeof v?.[key] === 'number' && Number.isInteger(v[key])
  return !!v && typeof v === 'object' && int('x') && int('y') && int('width') && int('height')
    && (v.x as number) >= 0 && (v.y as number) >= 0 && (v.width as number) >= 1 && (v.height as number) >= 1
    && (v.x as number) + (v.width as number) <= photo.width && (v.y as number) + (v.height as number) <= photo.height
}
export function validCrop(value: unknown, photo: Size): value is Crop {
  return validCropRect(value, photo) && ASPECTS.includes((value as Crop).aspect)
}
/** undefined when the crop keeps the whole photo (nothing to cut). */
export function normalizeCrop(crop: Crop, photo: Size): Crop | undefined {
  return crop.x === 0 && crop.y === 0 && crop.width === photo.width && crop.height === photo.height ? undefined : crop
}
export function sameCrop(a: Crop | undefined, b: Crop | undefined) {
  return a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height && a.aspect === b.aspect)
}
/** Keeps the size and slides the rectangle back inside the photo. */
export function moveCrop<T extends CropRect>(crop: T, x: number, y: number, photo: Size): T {
  return { ...crop, x: clamp(x, 0, photo.width - crop.width), y: clamp(y, 0, photo.height - crop.height) }
}
/**
 * Resizing with a handle: the edges opposite the dragged anchor stay put, the size stays inside the photo,
 * and a fixed ratio is kept (corner handles only; with a ratio the edge handles are hidden).
 * `next` is the box the handle asked for, `prev` the current one; anchors are Konva's ('top-left', 'middle-right', …).
 */
export function resizeCrop(prev: CropRect, next: CropRect, anchor: string, ratio: number | null, photo: Size): CropRect {
  const left = anchor.endsWith('left'), right = anchor.endsWith('right'), top = anchor.startsWith('top'), bottom = anchor.startsWith('bottom')
  const horizontal = left || right, vertical = top || bottom
  if (ratio && !(horizontal && vertical)) return prev
  const fixedRight = prev.x + prev.width, fixedBottom = prev.y + prev.height
  const maxWidth = !horizontal ? prev.width : left ? fixedRight : photo.width - prev.x
  const maxHeight = !vertical ? prev.height : top ? fixedBottom : photo.height - prev.y
  const min = minSide(photo)
  let width: number, height: number
  if (ratio) {
    // Follow whichever side the pointer moved more, so a mostly horizontal drag still resizes.
    const byWidth = Math.abs(next.width - prev.width) >= Math.abs(next.height - prev.height) * ratio
    width = byWidth ? next.width : next.height * ratio
    width = clamp(width, Math.min(Math.max(min, min * ratio), maxWidth, maxHeight * ratio), Math.min(maxWidth, maxHeight * ratio))
    height = width / ratio
  } else {
    width = horizontal ? clamp(next.width, Math.min(min, maxWidth), maxWidth) : prev.width
    height = vertical ? clamp(next.height, Math.min(min, maxHeight), maxHeight) : prev.height
  }
  return { x: left ? fixedRight - width : prev.x, y: top ? fixedBottom - height : prev.y, width, height }
}
/** Whole pixels inside the photo; a fixed ratio decides the height from the rounded width. */
export function roundCrop(rect: CropRect, ratio: number | null, photo: Size): CropRect {
  let width = clamp(Math.round(rect.width), 1, photo.width)
  let height = ratio ? Math.round(width / ratio) : clamp(Math.round(rect.height), 1, photo.height)
  if (height > photo.height) { height = photo.height; if (ratio) width = clamp(Math.round(height * ratio), 1, photo.width) }
  height = Math.max(1, height)
  return { x: clamp(Math.round(rect.x), 0, photo.width - width), y: clamp(Math.round(rect.y), 0, photo.height - height), width, height }
}
