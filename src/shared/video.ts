/**
 * MP4 export from the 동영상 mode (docs/video.md). Uses the user's own ffmpeg like GIF: a fixed argument array,
 * numbers only from validated options. Times are seconds in the source; sizes are display pixels (rotation applied).
 */
import { croppedWidth, frameGraph, validCropShape, type VideoCrop, type VideoSource } from './gif'
import type { OverlayFiles } from './video-overlay'
/** 0 = keep the (cropped) width. */
export const MP4_WIDTHS = [0, 1920, 1280, 1080, 720, 480] as const
export const MAX_MP4_SECONDS = 600
export interface Mp4Options { start: number; end: number; width: number; audio: boolean; crop?: VideoCrop }
export const DEFAULT_MP4 = { width: 0, audio: true }
export function validMp4Options(value: unknown, duration = Infinity): value is Mp4Options {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>, keys = Object.keys(item)
  if (!(keys.length === 4 || (keys.length === 5 && 'crop' in item && validCropShape(item.crop)))) return false
  if (![item.start, item.end, item.width].every(v => typeof v === 'number' && Number.isFinite(v)) || typeof item.audio !== 'boolean') return false
  const options = item as unknown as Mp4Options
  return options.start >= 0 && options.end <= duration + 0.05 && options.end - options.start >= 0.1 && options.end - options.start <= MAX_MP4_SECONDS
    && (MP4_WIDTHS as readonly number[]).includes(options.width)
}
/** H.264 encoders in order of preference: x264 (best quality per size), then the OS hardware/system encoders. */
export const H264_ENCODERS = ['libx264', 'h264_mf', 'h264_videotoolbox'] as const
export type H264Encoder = typeof H264_ENCODERS[number]
/** Picks an encoder from `ffmpeg -hide_banner -encoders` output; null when this ffmpeg cannot write H.264. */
export function pickH264Encoder(encoders: string): H264Encoder | null {
  return H264_ENCODERS.find(name => new RegExp(`^\\s*V\\S*\\s+${name}\\s`, 'm').test(encoders)) ?? null
}
/** Output width: never wider than the (cropped) video, even for 4:2:0. */
export function mp4Width(options: Pick<Mp4Options, 'width' | 'crop'>, videoWidth: number) {
  const source = croppedWidth(options.crop, videoWidth)
  return Math.floor(Math.min(options.width || source, source) / 2) * 2
}
export function mp4Args(input: string, output: string, options: Mp4Options, source: VideoSource, encoder: H264Encoder, overlays?: OverlayFiles): string[] {
  const width = mp4Width(options, source.width)
  // SDR BT.709 out, tagged as such: HDR is tone-mapped first (players would otherwise guess the colours).
  const frames = frameGraph(source, options.crop, [], `scale=${width}:-2:flags=lanczos`, ['scale=out_color_matrix=bt709:out_range=tv', 'format=yuv420p'], overlays)
  // x264 by quality; the system encoders take a bitrate (about 4 bits per output pixel per second, 2–12 Mbps).
  const quality = encoder === 'libx264' ? ['-preset', 'medium', '-crf', '20', '-profile:v', 'high']
    : ['-b:v', `${Math.max(2, Math.min(12, Math.round(width * width * 9 / 16 * 4 / 1e6)))}M`]
  const audio = options.audio ? ['-map', '0:a:0?', '-c:a', 'aac', '-b:a', '160k'] : ['-an']
  return ['-hide_banner', '-nostdin', '-loglevel', 'error', '-progress', 'pipe:1', '-ss', options.start.toFixed(3), '-t', (options.end - options.start).toFixed(3),
    '-i', input, ...frames.inputs, '-filter_complex', `${frames.graph}[vout]`, '-map', '[vout]', ...audio, '-sn', '-dn', '-c:v', encoder, ...quality,
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    // No location or camera metadata from the phone, and the index up front so the clip starts playing at once on the web.
    '-map_metadata', '-1', '-map_chapters', '-1', '-movflags', '+faststart', '-f', 'mp4', '-y', output]
}
/** An MP4 starts with an ISO BMFF `ftyp` box. */
export const isMp4 = (head: Uint8Array) => head.length >= 8 && String.fromCharCode(...head.subarray(4, 8)) === 'ftyp'
