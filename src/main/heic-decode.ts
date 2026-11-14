import libheif from 'libheif-js/wasm-bundle'
import { MAX_HEIC_PIXELS, MAX_HEIC_SIDE, type DecodedHeic } from './heic'

const fourcc = (text: string) => (text.charCodeAt(0) << 24 | text.charCodeAt(1) << 16 | text.charCodeAt(2) << 8 | text.charCodeAt(3)) >>> 0

/** The ICC profile ('prof'/'rICC') of the primary image, read through libheif's C API; undefined when absent or unreadable. */
function iccProfile(image: libheif.HeifImage): Uint8Array | undefined {
  try {
    const handle = (image.handle as { $$?: { ptr?: number } }).$$?.ptr
    if (!handle) return undefined
    const type = libheif._heif_image_handle_get_color_profile_type(handle) >>> 0
    if (type !== fourcc('prof') && type !== fourcc('rICC')) return undefined
    const size = libheif._heif_image_handle_get_raw_color_profile_size(handle)
    if (size <= 0 || size > 4 * 1024 * 1024) return undefined
    const error = libheif._malloc(16), data = libheif._malloc(size)
    try {
      libheif._heif_image_handle_get_raw_color_profile(error, handle, data) // heif_error is returned through the first pointer
      if (libheif.HEAP32[error >> 2] !== 0) return undefined
      return libheif.HEAPU8.slice(data, data + size)
    } finally { libheif._free(error); libheif._free(data) }
  } catch { return undefined }
}

/** Decodes the primary image (rotation/mirroring applied by libheif) into BGRA pixels for nativeImage. */
export async function decodeHeic(bytes: Uint8Array): Promise<DecodedHeic> {
  const decoder = new libheif.HeifDecoder()
  const images = decoder.decode(bytes)
  try {
    const image = images.find(item => item.is_primary()) ?? images[0]
    if (!image) throw new Error('HEIC 사진을 읽지 못했습니다. 손상되었거나 지원하지 않는 형식입니다.')
    const width = image.get_width(), height = image.get_height()
    if (!width || !height || width * height > MAX_HEIC_PIXELS || width > MAX_HEIC_SIDE || height > MAX_HEIC_SIDE) throw new Error('이미지 해상도 제한을 초과했습니다.')
    const icc = iccProfile(image)
    const data = new Uint8ClampedArray(width * height * 4)
    const done = await new Promise<unknown>(resolve => image.display({ data, width, height }, resolve))
    if (!done) throw new Error('HEIC 사진을 읽지 못했습니다. 손상되었거나 지원하지 않는 형식입니다.')
    const alpha = image.has_alpha_channel()
    // RGBA → BGRA; premultiply only when there is real transparency.
    for (let at = 0; at < data.length; at += 4) {
      const red = data[at], a = data[at + 3]
      if (alpha && a < 255) { data[at] = Math.round(data[at + 2] * a / 255); data[at + 1] = Math.round(data[at + 1] * a / 255); data[at + 2] = Math.round(red * a / 255) }
      else { data[at] = data[at + 2]; data[at + 2] = red }
    }
    return { width, height, pixels: new Uint8Array(data.buffer), alpha, icc }
  } finally {
    for (const item of images) item.free()
    if (decoder.decoder) libheif.heif_context_free(decoder.decoder)
  }
}
