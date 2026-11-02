export interface OutputSettings {
  format: 'png' | 'jpg'; resizeEnabled: boolean; resizeBasis: 'width' | 'longEdge'
  landscapeSize: number; portraitSize: number; preventUpscale: boolean; quality: number
}
export const DEFAULT_OUTPUT: OutputSettings = { format: 'png', resizeEnabled: false, resizeBasis: 'width', landscapeSize: 1600, portraitSize: 900, preventUpscale: true, quality: 100 }
const validLength = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 8192
export function validOutput(value: unknown): value is OutputSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return Object.keys(item).length === 7 && ['png', 'jpg'].includes(item.format as string)
    && typeof item.resizeEnabled === 'boolean' && ['width', 'longEdge'].includes(item.resizeBasis as string)
    && validLength(item.landscapeSize) && validLength(item.portraitSize)
    && typeof item.preventUpscale === 'boolean' && item.quality === 100
}
export function upgradeOutput(value: unknown, version: unknown): OutputSettings {
  if (version === 3 && validOutput(value)) return { ...value }
  if ([1, 2].includes(version as number) && value && typeof value === 'object' && !Array.isArray(value)) {
    const old = value as Record<string, unknown>
    if (Object.keys(old).length === 4 && ['png', 'jpg'].includes(old.format as string)
      && (old.width === null || validLength(old.width)) && typeof old.preventUpscale === 'boolean'
      && typeof old.quality === 'number' && Number.isInteger(old.quality) && old.quality >= 1 && old.quality <= 100
      && (version === 1 || old.quality === 100)) {
      return { ...DEFAULT_OUTPUT, format: old.format as 'png' | 'jpg', resizeEnabled: old.width !== null,
        landscapeSize: old.width as number ?? 1600, portraitSize: old.width as number ?? 900, preventUpscale: old.preventUpscale }
    }
  }
  throw new Error('출력 설정 파일이 손상되었습니다. 기존 파일은 보존합니다.')
}
export function outputSize(originalWidth: number, originalHeight: number, output: OutputSettings) {
  if (!validOutput(output) || !Number.isInteger(originalWidth) || !Number.isInteger(originalHeight) || originalWidth <= 0 || originalHeight <= 0) throw new Error('출력 길이와 설정을 확인하세요.')
  const length = originalHeight > originalWidth ? output.portraitSize : output.landscapeSize
  const basis = output.resizeBasis === 'longEdge' ? Math.max(originalWidth, originalHeight) : originalWidth
  const ratio = output.resizeEnabled ? (output.preventUpscale ? Math.min(1, length / basis) : length / basis) : 1
  const width = Math.max(1, Math.round(originalWidth * ratio)), height = Math.max(1, Math.round(originalHeight * ratio))
  if (width > 8192 || height > 8192 || width * height > 16_000_000) throw new Error('출력은 1,600만 픽셀, 한 변 8,192px 이하여야 합니다.')
  return { width, height }
}
export function outputKey(output: OutputSettings): string {
  return JSON.stringify([output.format, output.resizeEnabled ? [output.resizeBasis, output.landscapeSize, output.portraitSize, output.preventUpscale] : null])
}
