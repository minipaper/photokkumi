import type { BlurRegion } from '../shared/model'
import { regionBounds, regionPatch, sourceRect, type Rect } from '../shared/effects'
export interface RegionPatch { canvas: HTMLCanvasElement; bounds: Rect }
/** Builds the blur/mosaic pixels for one region from the original photo (logical photo pixels). */
export function buildRegionPatch(photo: ImageBitmap, region: BlurRegion): RegionPatch | null {
  const bounds = regionBounds(region, photo.width, photo.height)
  if (!bounds) return null
  const source = sourceRect(region, bounds, photo.width, photo.height)
  const reader = document.createElement('canvas')
  reader.width = source.width; reader.height = source.height
  const readContext = reader.getContext('2d', { willReadFrequently: true })
  if (!readContext) throw new Error('블러용 Canvas를 만들 수 없습니다.')
  readContext.drawImage(photo, source.x, source.y, source.width, source.height, 0, 0, source.width, source.height)
  const pixels = readContext.getImageData(0, 0, source.width, source.height)
  reader.width = 0; reader.height = 0
  const patch = regionPatch(region, { data: pixels.data, width: source.width, height: source.height }, source, bounds)
  const canvas = document.createElement('canvas')
  canvas.width = bounds.width; canvas.height = bounds.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('블러용 Canvas를 만들 수 없습니다.')
  context.putImageData(new ImageData(new Uint8ClampedArray(patch.data), patch.width, patch.height), 0, 0)
  return { canvas, bounds }
}
/** Adds the region's rotated ellipse to the current path (photo coordinates). */
export function ellipsePath(context: { ellipse: CanvasRenderingContext2D['ellipse']; beginPath(): void; closePath(): void }, region: BlurRegion) {
  context.beginPath()
  context.ellipse(region.x, region.y, region.width / 2, region.height / 2, region.rotation * Math.PI / 180, 0, Math.PI * 2)
  context.closePath()
}
export const regionKey = (region: BlurRegion) => [region.x, region.y, region.width, region.height, region.rotation, region.style, region.strength].join(':')
