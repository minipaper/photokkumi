import { DEFAULT_OUTPUT, outputSize, type OutputSettings } from '../shared/output'
import type { BlurRegion, StickerInstance } from '../shared/model'
import { buildRegionPatch, regionPath } from './regions'
import { renderAdjusted, releaseCanvas } from './filters'
import { NEUTRAL_ADJUSTMENTS, type Adjustments } from '../shared/filters'
import type { TextItem } from '../shared/text'
import { drawText, ensureTextFonts } from './text'
/** PNG encoding runs in a worker: main-thread canvas encoding waits for idle time and stalled saves for seconds when the window was behind. */
function encodePng(bitmap: ImageBitmap): Promise<Uint8Array> {
  const worker = new Worker(new URL('./encode-worker.ts', import.meta.url), { type: 'module' })
  return new Promise((resolve, reject) => {
    const fail = () => { worker.terminate(); reject(new Error('PNG 인코딩에 실패했습니다.')) }
    worker.onmessage = (event: MessageEvent<{ buffer?: ArrayBuffer }>) => { if (!event.data.buffer) { fail(); return } worker.terminate(); resolve(new Uint8Array(event.data.buffer)) }
    worker.onerror = fail
    worker.postMessage({ bitmap }, [bitmap])
  })
}
export async function composePng(photo: ImageBitmap, instances: StickerInstance[], assets: ReadonlyMap<string, { bitmap: ImageBitmap }>, output: OutputSettings = DEFAULT_OUTPUT, regions: BlurRegion[] = [], adjust: Adjustments = NEUTRAL_ADJUSTMENTS, texts: TextItem[] = []): Promise<Uint8Array> {
  // Fonts must be ready before drawing, or canvas silently falls back to another face.
  await ensureTextFonts(texts)
  const canvas = new OffscreenCanvas(1, 1)
  // Order: adjustments → blur/mosaic (hides adjusted pixels) → stickers (never adjusted) → texts.
  const adjusted = renderAdjusted(photo, adjust)
  const base = adjusted ?? photo
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
    context.drawImage(base, 0, 0)
    // Regions hide photo pixels only; stickers are always drawn above them.
    for (const region of regions) {
      const patch = buildRegionPatch(base, region)
      if (!patch) continue
      context.save()
      regionPath(context, region); context.clip()
      context.drawImage(patch.canvas, patch.bounds.x, patch.bounds.y)
      context.restore()
      patch.canvas.width = 0; patch.canvas.height = 0
    }
    for (const placement of [...instances].sort((a, b) => a.zOrder - b.zOrder)) {
      const sticker = assets.get(placement.assetId)?.bitmap
      if (!sticker) throw new Error('스티커 이미지가 없습니다.')
      context.save()
      context.translate(placement.x, placement.y)
      context.rotate(placement.rotation * Math.PI / 180)
      context.drawImage(sticker, -placement.width / 2, -placement.height / 2, placement.width, placement.height)
      context.restore()
    }
    for (const text of texts) {
      context.save()
      context.translate(text.x, text.y)
      context.rotate(text.rotation * Math.PI / 180)
      drawText(context, text)
      context.restore()
    }
    return await encodePng(canvas.transferToImageBitmap())
  } finally { canvas.width = 0; canvas.height = 0; releaseCanvas(adjusted) }
}
