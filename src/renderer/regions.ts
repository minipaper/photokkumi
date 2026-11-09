import type { BlurRegion } from '../shared/model'
import { regionBounds, regionPatch, sourceRect, type Rect } from '../shared/effects'
import type { PhotoSource } from './filters'
export interface RegionPatch { canvas: HTMLCanvasElement; bounds: Rect }
/** Builds the blur/mosaic pixels for one region from the original photo (logical photo pixels). */
export function buildRegionPatch(photo: PhotoSource, region: BlurRegion): RegionPatch | null {
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
type PathContext = { ellipse: CanvasRenderingContext2D['ellipse']; beginPath(): void; closePath(): void; moveTo(x: number, y: number): void; lineTo(x: number, y: number): void }
/** Adds the region's rotated ellipse or rectangle to the current path (photo coordinates). */
export function regionPath(context: PathContext, region: BlurRegion) {
  const angle = region.rotation * Math.PI / 180
  context.beginPath()
  if (region.shape === 'rect') {
    const cos = Math.cos(angle), sin = Math.sin(angle), a = region.width / 2, b = region.height / 2
    const corners = [[-a, -b], [a, -b], [a, b], [-a, b]].map(([dx, dy]) => [region.x + dx * cos - dy * sin, region.y + dx * sin + dy * cos])
    context.moveTo(corners[0][0], corners[0][1])
    for (const [x, y] of corners.slice(1)) context.lineTo(x, y)
  } else context.ellipse(region.x, region.y, region.width / 2, region.height / 2, angle, 0, Math.PI * 2)
  context.closePath()
}
export const regionKey = (region: BlurRegion) => [region.x, region.y, region.width, region.height, region.rotation, region.style, region.strength, region.shape ?? 'ellipse'].join(':')
