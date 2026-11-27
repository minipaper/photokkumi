import { turnedSize, type Turn } from '../shared/turn'
import { coverScale } from '../shared/straighten'
import type { GrayImage } from '../shared/level'
/**
 * The photo as shown and saved: turned by quarter turns clockwise, then tilted by `straighten` degrees and enlarged
 * to cover the frame. A plain quarter turn uses whole-pixel translations only, so nothing is resampled.
 * The caller owns the returned bitmap and closes it.
 */
export function renderOriented(bitmap: ImageBitmap, turn: Turn | undefined, straighten: number | undefined): ImageBitmap {
  const size = turnedSize(bitmap, turn)
  const canvas = new OffscreenCanvas(size.width, size.height)
  try {
    const context = canvas.getContext('2d')
    if (!context) throw new Error('사진을 회전할 Canvas를 만들 수 없습니다.')
    if (straighten) {
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      const scale = coverScale(size, straighten)
      context.translate(size.width / 2, size.height / 2)
      context.rotate(straighten * Math.PI / 180)
      context.scale(scale, scale)
      context.rotate((turn ?? 0) * Math.PI / 2)
      context.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2)
    } else {
      if (turn === 1) context.translate(size.width, 0)
      else if (turn === 2) context.translate(size.width, size.height)
      else if (turn === 3) context.translate(0, size.height)
      context.rotate((turn ?? 0) * Math.PI / 2)
      context.drawImage(bitmap, 0, 0)
    }
    return canvas.transferToImageBitmap()
  } finally { canvas.width = 0; canvas.height = 0 }
}
/** A small copy of the turned (not straightened) photo for auto level; long side at most `maxSide` pixels. */
export function sampleOriented(bitmap: ImageBitmap, turn: Turn | undefined, maxSide = 640): GrayImage {
  const size = turnedSize(bitmap, turn), scale = Math.min(1, maxSide / Math.max(size.width, size.height))
  const width = Math.max(1, Math.round(size.width * scale)), height = Math.max(1, Math.round(size.height * scale))
  const canvas = new OffscreenCanvas(width, height)
  try {
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('사진을 분석할 Canvas를 만들 수 없습니다.')
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.scale(width / size.width, height / size.height)
    if (turn === 1) context.translate(size.width, 0)
    else if (turn === 2) context.translate(size.width, size.height)
    else if (turn === 3) context.translate(0, size.height)
    context.rotate((turn ?? 0) * Math.PI / 2)
    context.drawImage(bitmap, 0, 0)
    return { data: context.getImageData(0, 0, width, height).data, width, height, channels: 4 }
  } finally { canvas.width = 0; canvas.height = 0 }
}
