import { imageSize } from 'image-size'
import type { AssetKind } from '../shared/model'

export const MAX_FILE_BYTES = 32 * 1024 * 1024
export const MAX_OUTPUT_BYTES = 80 * 1024 * 1024
export const MAX_PIXELS = 16_000_000
export const MAX_STICKER_PIXELS = 4_000_000
export function inspectImage(bytes: Uint8Array, kind: AssetKind, output = false) {
  if (!bytes.length || bytes.length > (output ? MAX_OUTPUT_BYTES : MAX_FILE_BYTES)) {
    throw new Error('이미지 파일 크기 제한을 초과했습니다.')
  }
  const png = Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  if (!png && (!jpeg || kind === 'sticker' || output)) throw new Error('사진은 JPG/PNG, 스티커는 PNG만 지원합니다.')
  let dimensions: ReturnType<typeof imageSize>
  try { dimensions = imageSize(bytes) } catch { throw new Error('이미지 헤더가 손상되었습니다.') }
  let { width, height } = dimensions
  if (!width || !height || width * height > (kind === 'sticker' ? MAX_STICKER_PIXELS : MAX_PIXELS)
    || width > 8192 || height > 8192) throw new Error('이미지 해상도 제한을 초과했습니다.')
  if (dimensions.orientation && dimensions.orientation >= 5) [width, height] = [height, width]
  return { width, height, mime: png ? 'image/png' as const : 'image/jpeg' as const }
}
