/**
 * Photo adjustments shared by preview and export. Each value is −100…100 with 0 meaning unchanged.
 * Exposure (±2 EV) and temperature act on linear light; contrast and saturation act on sRGB values.
 */
export interface Adjustments { exposure: number; contrast: number; saturation: number; temperature: number }
export const ADJUSTMENT_KEYS = ['exposure', 'contrast', 'saturation', 'temperature'] as const
export const NEUTRAL_ADJUSTMENTS: Adjustments = { exposure: 0, contrast: 0, saturation: 0, temperature: 0 }
export function validAdjustments(value: unknown): value is Adjustments {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return Object.keys(item).length === 4 && ADJUSTMENT_KEYS.every(key => Number.isInteger(item[key]) && Math.abs(item[key] as number) <= 100)
}
export const isNeutral = (value: Adjustments) => ADJUSTMENT_KEYS.every(key => value[key] === 0)
export const sameAdjustments = (a: Adjustments, b: Adjustments) => ADJUSTMENT_KEYS.every(key => a[key] === b[key])

const toLinear = new Float32Array(256).map((_, index) => { const v = index / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 })
const toSrgb = (v: number) => v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055

/** Applies adjustments in place to RGBA pixels (alpha untouched). */
export function applyAdjustments(data: Uint8ClampedArray, value: Adjustments): void {
  if (isNeutral(value)) return
  const gain = 2 ** (value.exposure / 50)
  const warm = value.temperature / 100
  const gains = [gain * (1 + 0.4 * warm), gain * (1 + 0.06 * warm), gain * (1 - 0.4 * warm)]
  const contrast = value.contrast >= 0 ? 1 + value.contrast / 100 : 1 + value.contrast / 125
  const saturation = 1 + value.saturation / 100
  // Per-channel lookup tables for the linear-light stage followed by contrast.
  const tables = gains.map(channelGain => {
    const table = new Float32Array(256)
    for (let index = 0; index < 256; index++) {
      const srgb = toSrgb(Math.min(1, toLinear[index] * channelGain))
      table[index] = (srgb - 0.5) * contrast + 0.5
    }
    return table
  })
  for (let offset = 0; offset < data.length; offset += 4) {
    const r = tables[0][data[offset]], g = tables[1][data[offset + 1]], b = tables[2][data[offset + 2]]
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
    data[offset] = Math.round((luma + (r - luma) * saturation) * 255)
    data[offset + 1] = Math.round((luma + (g - luma) * saturation) * 255)
    data[offset + 2] = Math.round((luma + (b - luma) * saturation) * 255)
  }
}
