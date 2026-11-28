/** GIF export options and ffmpeg argument building. Times are seconds in the source video. */
import { parseColor, toneMapFilter, type VideoColor } from './hdr'
import { overlayGraph, overlayInputs, type OverlayFiles } from './video-overlay'
/** Part of the video to keep, in display pixels (rotation applied); see video.ts. */
export interface VideoCrop { x: number; y: number; width: number; height: number }
export interface GifOptions { start: number; end: number; width: number; fps: number; crop?: VideoCrop }
export interface VideoRef { id: string; name: string }
export interface VideoInfo extends VideoRef { duration: number; width: number; height: number; hasAudio: boolean; color: VideoColor; previewFps: number; frames: Uint8Array[] }
export interface GifReceipt { name: string; folderLabel: string; bytes: number }
export interface ToolStatus { found: boolean; path: string | null; version: string | null }
export const GIF_WIDTHS = [320, 480, 640, 800] as const
export const GIF_FPS = [8, 10, 12, 15, 20, 24] as const
export const DEFAULT_GIF = { width: 480, fps: 12 }
export const MAX_GIF_SECONDS = 30
export const MAX_GIF_FRAMES = 600
export const MAX_PREVIEW_FRAMES = 300
export const VIDEO_EXTENSIONS = ['.mov', '.mp4', '.m4v']

export function gifFrameCount(options: Pick<GifOptions, 'start' | 'end' | 'fps'>) { return Math.max(1, Math.ceil((options.end - options.start) * options.fps - 1e-9)) }
export function validGifOptions(value: unknown, duration = Infinity): value is GifOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  const keys = Object.keys(item)
  if (!(keys.length === 4 || (keys.length === 5 && 'crop' in item && validCropShape(item.crop)))
    || ![item.start, item.end, item.width, item.fps].every(v => typeof v === 'number' && Number.isFinite(v))) return false
  const options = item as unknown as GifOptions
  return options.start >= 0 && options.end <= duration + 0.05 && options.end - options.start >= 0.1 && options.end - options.start <= MAX_GIF_SECONDS
    && (GIF_WIDTHS as readonly number[]).includes(options.width) && (GIF_FPS as readonly number[]).includes(options.fps)
    && gifFrameCount(options) <= MAX_GIF_FRAMES
}
/** Crop shape only (four non-negative integers, at least 16px); main checks it against the video size. */
export function validCropShape(value: unknown): value is VideoCrop {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 4) return false
  const crop = value as Record<string, unknown>
  return ['x', 'y', 'width', 'height'].every(key => Number.isInteger(crop[key]) && (crop[key] as number) >= 0)
    && (crop.width as number) >= 16 && (crop.height as number) >= 16
}
/** The crop fits the video (display pixels). */
export function cropFits(crop: VideoCrop | undefined, video: { width: number; height: number }) {
  return !crop || (crop.x + crop.width <= video.width && crop.y + crop.height <= video.height)
}
/** ffmpeg crop filter with even numbers (H.264's 4:2:0 needs them; GIF does not care). */
export function cropFilter(crop: VideoCrop | undefined): string[] {
  if (!crop) return []
  const even = (value: number) => Math.floor(value / 2) * 2
  return [`crop=${even(crop.width)}:${even(crop.height)}:${even(crop.x)}:${even(crop.y)}`]
}
/** Width after cropping (display pixels): the crop, or the whole video. */
export const croppedWidth = (crop: VideoCrop | undefined, videoWidth: number) => crop ? Math.floor(crop.width / 2) * 2 : videoWidth
/** Preview sampling rate: up to 10 fps, fewer for long clips so at most MAX_PREVIEW_FRAMES are decoded. */
export function previewFps(duration: number) { return Math.max(0.2, Math.min(10, Math.floor(MAX_PREVIEW_FRAMES / Math.max(duration, 0.1) * 10) / 10)) }

const seconds = (value: number) => value.toFixed(3)
/** The video as the app sees it: display size (rotation applied) and colour curve. */
export interface VideoSource { width: number; height: number; color: VideoColor }
/** Joins filters, skipping empty ones (no tone mapping for SDR). */
export const chain = (...filters: string[]) => filters.filter(Boolean).join(',')
export function previewArgs(input: string, fps: number, color: VideoColor = 'sdr'): string[] {
  return ['-hide_banner', '-nostdin', '-loglevel', 'error', '-i', input, '-an', '-sn', '-dn',
    '-vf', chain(`fps=${fps},scale=640:-2`, toneMapFilter(color)), '-frames:v', String(MAX_PREVIEW_FRAMES), '-q:v', '6', '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:1']
}
/**
 * The frame part of the filter graph, from [0:v] to the end of a chain the caller continues (`…,split` or `…[vout]`).
 * Without overlays: crop → frame rate → scale → HDR→SDR → tail (cheapest: tone mapping runs on the small frames).
 * With overlays they are placed in full-size display pixels, after tone mapping (stickers are SDR), before the crop.
 */
export function frameGraph(source: VideoSource, crop: VideoCrop | undefined, rate: string[], scale: string, tail: string[], overlays?: OverlayFiles) {
  if (!overlays) return { graph: `[0:v]${chain(...cropFilter(crop), ...rate, scale, toneMapFilter(source.color), ...tail)}`, inputs: [] as string[] }
  const inputs = overlayInputs(overlays)
  return {
    graph: `[0:v]${chain(...rate, toneMapFilter(source.color), 'format=rgb24')}[ov_0];${overlayGraph(overlays.regions, source, inputs, 'ov_0', 'ov_out')};[ov_out]${chain(...cropFilter(crop), scale, ...tail)}`,
    inputs: inputs.args
  }
}
export function gifArgs(input: string, output: string, options: GifOptions, source: VideoSource, overlays?: OverlayFiles): string[] {
  const width = Math.min(options.width, croppedWidth(options.crop, source.width))
  // Two-pass palette in one graph keeps colours far better than ffmpeg's default GIF palette.
  const frames = frameGraph(source, options.crop, [`fps=${options.fps}`], `scale=${width}:-1:flags=lanczos`, ['format=rgb24'], overlays)
  const graph = `${frames.graph},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`
  return ['-hide_banner', '-nostdin', '-loglevel', 'error', '-progress', 'pipe:1', '-ss', seconds(options.start), '-t', seconds(options.end - options.start),
    '-i', input, ...frames.inputs, '-an', '-sn', '-dn', '-filter_complex', graph, '-frames:v', String(gifFrameCount(options)), '-loop', '0', '-f', 'gif', '-y', output]
}
/** Reads duration, display size (rotation applied) from `ffmpeg -i` stderr. */
export function parseProbe(stderr: string): { duration: number; width: number; height: number; hasAudio: boolean; color: VideoColor } {
  const duration = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(stderr)
  const video = /Stream #[^\n]*Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/.exec(stderr)
  if (!duration || !video) throw new Error('동영상 길이나 화면 크기를 읽을 수 없습니다.')
  const total = Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])
  if (!(total > 0)) throw new Error('동영상 길이를 확인할 수 없습니다.')
  const rotation = /rotation of (-?\d+(?:\.\d+)?) degrees|rotate\s*:\s*(-?\d+)/.exec(stderr)
  const turned = rotation ? Math.abs(Math.round(Number(rotation[1] ?? rotation[2]) / 90)) % 2 === 1 : false
  const width = Number(video[1]), height = Number(video[2])
  return { duration: total, width: turned ? height : width, height: turned ? width : height, hasAudio: /Stream #[^\n]*Audio:/.test(stderr), color: parseColor(stderr) }
}
/** Splits ffmpeg's concatenated MJPEG output into separate JPEG files. Entropy data byte-stuffs 0xFF, so FFD9 only marks an end. */
export function splitJpegs(bytes: Uint8Array): Uint8Array[] {
  const frames: Uint8Array[] = []
  let start = -1
  for (let i = 0; i + 1 < bytes.length; i++) {
    if (bytes[i] !== 0xff) continue
    if (start < 0 && bytes[i + 1] === 0xd8) start = i
    else if (start >= 0 && bytes[i + 1] === 0xd9) { frames.push(bytes.slice(start, i + 2)); start = -1; i++ }
  }
  return frames
}
export function parseProgress(chunk: string): number | null {
  const matches = [...chunk.matchAll(/out_time_us=(\d+)/g)]
  return matches.length ? Number(matches.at(-1)![1]) / 1e6 : null
}
