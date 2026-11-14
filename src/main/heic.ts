import { Worker } from 'node:worker_threads'

/**
 * HEIC (iPhone) photos: Chromium cannot decode HEVC images, so the main process decodes them with libheif (WASM, LGPL-3.0)
 * in a short-lived worker thread and hands the editor an ordinary JPEG. See docs/heic.md.
 */
export interface DecodedHeic {
  width: number; height: number
  /** width × height × 4 bytes in the platform bitmap order nativeImage expects (BGRA, premultiplied alpha). */
  pixels: Uint8Array
  alpha: boolean
  /** Embedded ICC profile (iPhone: Display P3), carried into the JPEG so Chromium color-manages it like an iPhone JPG. */
  icc?: Uint8Array
}
export const HEIC_EXTENSIONS = ['.heic', '.heif']
/** Decode limits before the full image is decoded (iPhone 48MP HEIF is 8064×6048). */
export const MAX_HEIC_PIXELS = 50_000_000
export const MAX_HEIC_SIDE = 16384
const HEVC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx'])

/** An ISO-BMFF file whose ftyp box names an HEVC image brand (major or compatible). AVIF and others stay unsupported. */
export function isHeic(bytes: Uint8Array): boolean {
  if (bytes.length < 16) return false
  const text = (from: number) => String.fromCharCode(bytes[from], bytes[from + 1], bytes[from + 2], bytes[from + 3])
  if (text(4) !== 'ftyp') return false
  const size = Math.min(((bytes[0] << 24) >>> 0) + (bytes[1] << 16) + (bytes[2] << 8) + bytes[3], bytes.length, 256)
  if (HEVC_BRANDS.has(text(8))) return true
  for (let at = 16; at + 4 <= size; at += 4) if (HEVC_BRANDS.has(text(at))) return true
  return false
}

/** The largest size with the same shape inside the pixel and side limits (whole pixels, never enlarged). */
export function fitPixels(width: number, height: number, maxPixels: number, maxSide: number) {
  const scale = Math.min(1, Math.sqrt(maxPixels / (width * height)), maxSide / width, maxSide / height)
  if (scale === 1) return { width, height }
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) }
}

/** Inserts an ICC profile as APP2 ICC_PROFILE segments right after SOI/JFIF, as cameras do. */
export function withIccProfile(jpeg: Buffer, icc?: Uint8Array): Buffer {
  const chunk = 65519 // 65535 − 2 length bytes − 14 header bytes
  if (!icc?.length || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return jpeg
  const count = Math.ceil(icc.length / chunk)
  if (count > 255) return jpeg
  let at = 2
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) at = 4 + jpeg.readUInt16BE(4)
  const segments: Buffer[] = []
  for (let index = 0; index < count; index++) {
    const data = icc.subarray(index * chunk, (index + 1) * chunk)
    const header = Buffer.alloc(18)
    header.writeUInt16BE(0xffe2, 0); header.writeUInt16BE(data.length + 16, 2)
    header.write('ICC_PROFILE\0', 4, 'latin1'); header[16] = index + 1; header[17] = count
    segments.push(header, Buffer.from(data))
  }
  return Buffer.concat([jpeg.subarray(0, at), ...segments, jpeg.subarray(at)])
}

/** Decodes in a fresh worker so a large decode never blocks the window and its WASM memory is released afterwards. */
export function decodeHeicInWorker(workerFile: string, bytes: Uint8Array, timeoutMs = 120_000): Promise<DecodedHeic> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerFile)
    let settled = false
    const finish = (error: Error | null, value?: DecodedHeic) => {
      if (settled) return
      settled = true; clearTimeout(timer); void worker.terminate()
      if (error) reject(error); else resolve(value!)
    }
    const timer = setTimeout(() => finish(new Error('HEIC 사진 변환 시간이 너무 오래 걸립니다.')), timeoutMs)
    worker.once('message', (message: { ok: true; value: DecodedHeic } | { ok: false; error: string }) => {
      if (message.ok) finish(null, message.value); else finish(new Error(message.error))
    })
    worker.once('error', () => finish(new Error('HEIC 사진을 읽지 못했습니다.')))
    worker.once('exit', () => finish(new Error('HEIC 사진을 읽지 못했습니다.')))
    worker.postMessage(bytes)
  })
}
