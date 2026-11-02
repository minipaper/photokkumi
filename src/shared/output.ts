export interface OutputSettings { format: 'png' | 'jpg'; width: number | null; preventUpscale: boolean; quality: number }
export const DEFAULT_OUTPUT: OutputSettings = { format: 'png', width: null, preventUpscale: true, quality: 90 }
export function validOutput(value: unknown): value is OutputSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return Object.keys(item).length === 4 && ['png', 'jpg'].includes(item.format as string)
    && (item.width === null || (typeof item.width === 'number' && Number.isInteger(item.width) && item.width > 0 && item.width <= 8192))
    && typeof item.preventUpscale === 'boolean' && typeof item.quality === 'number'
    && Number.isInteger(item.quality) && item.quality >= 1 && item.quality <= 100
}
export function outputSize(originalWidth: number, originalHeight: number, output: OutputSettings) {
  if (!validOutput(output) || !Number.isInteger(originalWidth) || !Number.isInteger(originalHeight) || originalWidth <= 0 || originalHeight <= 0) throw new Error('출력 너비와 JPG 품질을 확인하세요.')
  const width = output.width === null ? originalWidth : output.preventUpscale ? Math.min(output.width, originalWidth) : output.width
  const height = Math.max(1, Math.round(originalHeight * width / originalWidth))
  if (width > 8192 || height > 8192 || width * height > 16_000_000) throw new Error('출력은 1,600만 픽셀, 한 변 8,192px 이하여야 합니다.')
  return { width, height }
}
export function outputKey(output: OutputSettings): string {
  return JSON.stringify([output.format, output.width, output.preventUpscale, output.format === 'jpg' ? output.quality : null])
}
