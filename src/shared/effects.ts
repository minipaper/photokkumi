import type { BlurRegion } from './model'
/**
 * Blur/mosaic pixel math shared by the editor preview and the exporter, so both produce the same patch.
 * Units are logical photo pixels. Strength 1–100 scales with the region's short side.
 */
export interface Rect { x: number; y: number; width: number; height: number }
export interface Pixels { data: Uint8ClampedArray; width: number; height: number }

export function blurSigma(region: Pick<BlurRegion, 'width' | 'height' | 'strength'>) {
  return Math.max(1, Math.min(region.width, region.height) * region.strength / 100 * 0.15)
}
export function mosaicBlock(region: Pick<BlurRegion, 'width' | 'height' | 'strength'>) {
  return Math.max(2, Math.round(Math.min(region.width, region.height) * region.strength / 100 * 0.25))
}
/** Axis-aligned bounds of the rotated ellipse clamped to the photo, in whole pixels; null if fully outside. */
export function regionBounds(region: Pick<BlurRegion, 'x' | 'y' | 'width' | 'height' | 'rotation'>, photoWidth: number, photoHeight: number): Rect | null {
  const a = region.width / 2, b = region.height / 2, angle = region.rotation * Math.PI / 180
  const ex = Math.hypot(a * Math.cos(angle), b * Math.sin(angle)), ey = Math.hypot(a * Math.sin(angle), b * Math.cos(angle))
  const left = Math.max(0, Math.floor(region.x - ex)), top = Math.max(0, Math.floor(region.y - ey))
  const right = Math.min(photoWidth, Math.ceil(region.x + ex)), bottom = Math.min(photoHeight, Math.ceil(region.y + ey))
  return right > left && bottom > top ? { x: left, y: top, width: right - left, height: bottom - top } : null
}
/** Source area needed to compute `bounds`: blur needs neighbours, mosaic needs whole grid cells. */
export function sourceRect(region: BlurRegion, bounds: Rect, photoWidth: number, photoHeight: number): Rect {
  let left: number, top: number, right: number, bottom: number
  if (region.style === 'blur') {
    const pad = Math.ceil(blurSigma(region) * 3)
    left = bounds.x - pad; top = bounds.y - pad; right = bounds.x + bounds.width + pad; bottom = bounds.y + bounds.height + pad
  } else {
    const block = mosaicBlock(region)
    left = Math.floor(bounds.x / block) * block; top = Math.floor(bounds.y / block) * block
    right = Math.ceil((bounds.x + bounds.width) / block) * block; bottom = Math.ceil((bounds.y + bounds.height) / block) * block
  }
  left = Math.max(0, left); top = Math.max(0, top)
  return { x: left, y: top, width: Math.min(photoWidth, right) - left, height: Math.min(photoHeight, bottom) - top }
}
function boxSizes(sigma: number, passes: number) {
  const ideal = Math.sqrt(12 * sigma * sigma / passes + 1)
  let lower = Math.floor(ideal); if (lower % 2 === 0) lower--
  const upper = lower + 2, count = Math.round((12 * sigma * sigma - passes * lower * lower - 4 * passes * lower - 3 * passes) / (-4 * lower - 4))
  return Array.from({ length: passes }, (_, index) => index < count ? lower : upper)
}
function boxPass(input: Float32Array, output: Float32Array, width: number, height: number, radius: number, horizontal: boolean) {
  const lines = horizontal ? height : width, length = horizontal ? width : height, scale = 1 / (radius * 2 + 1)
  for (let line = 0; line < lines; line++) {
    const at = (position: number) => (horizontal ? line * width + Math.min(length - 1, Math.max(0, position)) : Math.min(length - 1, Math.max(0, position)) * width + line) * 4
    for (let channel = 0; channel < 4; channel++) {
      let sum = 0
      for (let offset = -radius; offset <= radius; offset++) sum += input[at(offset) + channel]
      for (let position = 0; position < length; position++) {
        output[at(position) + channel] = sum * scale
        sum += input[at(position + radius + 1) + channel] - input[at(position - radius) + channel]
      }
    }
  }
}
/** Gaussian approximation (3 box passes) with clamped edges. */
export function blurPixels(source: Pixels, sigma: number): Uint8ClampedArray {
  let current = Float32Array.from(source.data), scratch = new Float32Array(current.length)
  for (const size of boxSizes(sigma, 3)) {
    const radius = (size - 1) / 2
    if (radius < 1) continue
    boxPass(current, scratch, source.width, source.height, radius, true);[current, scratch] = [scratch, current]
    boxPass(current, scratch, source.width, source.height, radius, false);[current, scratch] = [scratch, current]
  }
  return Uint8ClampedArray.from(current)
}
/** Averages each block of the photo grid; `origin` is the source's position in photo pixels so blocks stay put when the region moves. */
export function mosaicPixels(source: Pixels, block: number, origin: { x: number; y: number }): Uint8ClampedArray {
  const output = new Uint8ClampedArray(source.data.length)
  const startX = Math.floor(origin.x / block) * block - origin.x, startY = Math.floor(origin.y / block) * block - origin.y
  for (let top = startY; top < source.height; top += block) for (let left = startX; left < source.width; left += block) {
    const x0 = Math.max(0, left), y0 = Math.max(0, top), x1 = Math.min(source.width, left + block), y1 = Math.min(source.height, top + block)
    const sum = [0, 0, 0, 0]
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) for (let c = 0; c < 4; c++) sum[c] += source.data[(y * source.width + x) * 4 + c]
    const count = (x1 - x0) * (y1 - y0)
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) for (let c = 0; c < 4; c++) output[(y * source.width + x) * 4 + c] = Math.round(sum[c] / count)
  }
  return output
}
/** Effect pixels for `bounds`, cut out of the processed source. */
export function regionPatch(region: BlurRegion, source: Pixels, sourceAt: Rect, bounds: Rect): Pixels {
  const processed = region.style === 'blur' ? blurPixels(source, blurSigma(region)) : mosaicPixels(source, mosaicBlock(region), sourceAt)
  const data = new Uint8ClampedArray(bounds.width * bounds.height * 4)
  for (let y = 0; y < bounds.height; y++) {
    const from = ((y + bounds.y - sourceAt.y) * source.width + (bounds.x - sourceAt.x)) * 4
    data.set(processed.subarray(from, from + bounds.width * 4), y * bounds.width * 4)
  }
  return { data, width: bounds.width, height: bounds.height }
}
