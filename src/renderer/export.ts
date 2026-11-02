import type { Placement } from '../shared/model'
export async function composePng(photo: ImageBitmap, sticker: ImageBitmap | null, placement: Placement | null): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  canvas.width = photo.width
  canvas.height = photo.height
  try {
    const context = canvas.getContext('2d')
    if (!context) throw new Error('합성용 Canvas를 만들 수 없습니다.')
    context.drawImage(photo, 0, 0)
    if (sticker && placement) {
      context.save()
      context.translate(placement.x, placement.y)
      context.rotate(placement.rotation * Math.PI / 180)
      context.drawImage(sticker, -placement.width / 2, -placement.height / 2, placement.width, placement.height)
      context.restore()
    }
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      value => value ? resolve(value) : reject(new Error('PNG 인코딩에 실패했습니다.')), 'image/png'
    ))
    return new Uint8Array(await blob.arrayBuffer())
  } finally { canvas.width = 0; canvas.height = 0 }
}
