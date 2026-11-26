import { turnedSize, type Turn } from '../shared/turn'
/**
 * The photo turned by quarter turns clockwise, pixel for pixel: whole-pixel translations only, so nothing is resampled.
 * The caller owns the returned bitmap and closes it.
 */
export function renderTurned(bitmap: ImageBitmap, turn: Turn): ImageBitmap {
  const size = turnedSize(bitmap, turn)
  const canvas = new OffscreenCanvas(size.width, size.height)
  try {
    const context = canvas.getContext('2d')
    if (!context) throw new Error('사진을 회전할 Canvas를 만들 수 없습니다.')
    if (turn === 1) context.translate(size.width, 0)
    else if (turn === 2) context.translate(size.width, size.height)
    else context.translate(0, size.height)
    context.rotate(turn * Math.PI / 2)
    context.drawImage(bitmap, 0, 0)
    return canvas.transferToImageBitmap()
  } finally { canvas.width = 0; canvas.height = 0 }
}
