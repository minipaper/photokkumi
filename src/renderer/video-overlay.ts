/**
 * 동영상 가리기·스티커 in the renderer. Items are edited on the preview frame (preview pixels, the same Scene model
 * as photos) and turned into video display pixels only when saving: region numbers, one mask PNG per region and
 * one transparent sticker layer at the full video size (src/shared/video-overlay.ts explains what ffmpeg does).
 */
import type { Scene } from '../shared/scene'
import type { BlurRegion } from '../shared/model'
import { maskBounds, validVideoRegion, type VideoOverlayRequest, type VideoRegion } from '../shared/video-overlay'
import { buildRegionPatch, regionPath } from './regions'

interface Size { width: number; height: number }
type Assets = ReadonlyMap<string, { bitmap: ImageBitmap }>

/** Preview → video pixels. The preview is the video scaled to 640px wide (height rounded to even), so x and y scale apart. */
export function toVideoRegion(region: BlurRegion, frame: Size, video: Size): VideoRegion {
  const kx = video.width / frame.width, ky = video.height / frame.height
  return { x: region.x * kx, y: region.y * ky, width: region.width * kx, height: region.height * ky, rotation: region.rotation, style: region.style, strength: region.strength, shape: region.shape ?? 'ellipse' }
}
async function pngBytes(canvas: OffscreenCanvas) {
  return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())
}
function drawStickers(context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, scene: Scene, assets: Assets) {
  for (const placement of [...scene.stickers].sort((a, b) => a.zOrder - b.zOrder)) {
    const sticker = assets.get(placement.assetId)?.bitmap
    if (!sticker) throw new Error('스티커 이미지가 없습니다.')
    context.save()
    context.translate(placement.x, placement.y)
    context.rotate(placement.rotation * Math.PI / 180)
    context.drawImage(sticker, -placement.width / 2, -placement.height / 2, placement.width, placement.height)
    context.restore()
  }
}
/** What to send with the export, or null when nothing is placed. Regions entirely outside the video are skipped. */
export async function overlayRequest(scene: Scene, frame: Size, video: Size, assets: Assets): Promise<VideoOverlayRequest | null> {
  const regions = scene.regions.map(region => toVideoRegion(region, frame, video)).filter(region => validVideoRegion(region, video))
  if (!regions.length && !scene.stickers.length) return null
  const masks: Uint8Array[] = []
  for (const region of regions) {
    // White = hidden. Drawn with the same path as the photo editor, so edges are anti-aliased the same way.
    const bounds = maskBounds(region, video)
    const canvas = new OffscreenCanvas(bounds.width, bounds.height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('가림 모양을 만들 수 없습니다.')
    context.fillStyle = '#000'; context.fillRect(0, 0, bounds.width, bounds.height)
    context.translate(-bounds.x, -bounds.y)
    regionPath(context, { ...region, id: '' })
    context.fillStyle = '#fff'; context.fill()
    masks.push(await pngBytes(canvas))
  }
  let layer: Uint8Array | null = null
  if (scene.stickers.length) {
    const canvas = new OffscreenCanvas(video.width, video.height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('스티커 층을 만들 수 없습니다.')
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high'
    context.scale(video.width / frame.width, video.height / frame.height)
    drawStickers(context, scene, assets)
    layer = await pngBytes(canvas)
    canvas.width = 0; canvas.height = 0
  }
  return { regions, masks, layer }
}
/** Read-only preview of the placed items over the current frame (the 저장 tab), drawn into a frame-sized canvas. */
export function drawOverlayPreview(canvas: HTMLCanvasElement, frame: ImageBitmap, scene: Scene, assets: Assets) {
  if (canvas.width !== frame.width || canvas.height !== frame.height) { canvas.width = frame.width; canvas.height = frame.height }
  const context = canvas.getContext('2d')
  if (!context) return
  context.clearRect(0, 0, canvas.width, canvas.height)
  for (const region of scene.regions) {
    const patch = buildRegionPatch(frame, region)
    if (!patch) continue
    context.save()
    regionPath(context, region); context.clip()
    context.drawImage(patch.canvas, patch.bounds.x, patch.bounds.y)
    context.restore()
    patch.canvas.width = 0; patch.canvas.height = 0
  }
  drawStickers(context, scene, assets)
}
