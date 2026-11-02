import { DEFAULT_OUTPUT, outputSize, type OutputSettings } from '../shared/output'
import type { StickerInstance } from '../shared/model'
export async function composePng(photo: ImageBitmap, instances: StickerInstance[], assets: ReadonlyMap<string, { bitmap: ImageBitmap }>, output: OutputSettings = DEFAULT_OUTPUT): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  const size = outputSize(photo.width, photo.height, output)
  canvas.width = size.width
  canvas.height = size.height
  try {
    const context = canvas.getContext('2d')
    if (!context) throw new Error('합성용 Canvas를 만들 수 없습니다.')
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    if (output.format === 'jpg') { context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height) }
    context.scale(size.width / photo.width, size.height / photo.height)
    context.drawImage(photo, 0, 0)
    for (const placement of [...instances].sort((a, b) => a.zOrder - b.zOrder)) {
      const sticker = assets.get(placement.assetId)?.bitmap
      if (!sticker) throw new Error('스티커 이미지가 없습니다.')
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
