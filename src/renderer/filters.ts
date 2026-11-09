import { applyAdjustments, isNeutral, type Adjustments } from '../shared/filters'
export type PhotoSource = ImageBitmap | HTMLCanvasElement
/**
 * Draws the photo with adjustments applied. `maxSide` produces a reduced copy for fast live preview;
 * without it the result is full resolution (logical photo pixels) for export and region patches.
 * Returns null for neutral adjustments so callers keep using the original bitmap untouched.
 */
export function renderAdjusted(photo: ImageBitmap, adjust: Adjustments, maxSide?: number): HTMLCanvasElement | null {
  if (isNeutral(adjust)) return null
  const factor = maxSide ? Math.min(1, maxSide / Math.max(photo.width, photo.height)) : 1
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(photo.width * factor)); canvas.height = Math.max(1, Math.round(photo.height * factor))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('보정용 Canvas를 만들 수 없습니다.')
  context.imageSmoothingQuality = 'high'
  context.drawImage(photo, 0, 0, canvas.width, canvas.height)
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
  applyAdjustments(pixels.data, adjust)
  context.putImageData(pixels, 0, 0)
  return canvas
}
export function releaseCanvas(canvas: HTMLCanvasElement | null | undefined) { if (canvas) { canvas.width = 0; canvas.height = 0 } }
