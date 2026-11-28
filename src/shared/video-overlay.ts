/**
 * Blur/mosaic areas and stickers fixed on a video (동영상 → 가리기·스티커, docs/video.md). The renderer edits them like
 * on a photo and sends, in video display pixels: the regions as numbers, one grey mask PNG per region (its exact
 * shape inside its bounds) and one transparent PNG with every sticker at the full video size. main checks all of it
 * and ffmpeg applies them to every frame: crop the area, blur or pixelate it, cut it to the mask, lay it back.
 */
import { blurSigma, mosaicBlock, regionBounds, sourceRect, type Rect } from './effects'
import type { RegionShape, RegionStyle } from './model'

export const MAX_VIDEO_REGIONS = 16
export const MAX_LAYER_BYTES = 64 * 1024 * 1024
export const MAX_MASK_BYTES = 16 * 1024 * 1024
export interface VideoRegion { x: number; y: number; width: number; height: number; rotation: number; style: RegionStyle; strength: number; shape: RegionShape }
/** What the renderer sends with a GIF/MP4 request. Masks follow the order of the regions. */
export interface VideoOverlayRequest { regions: VideoRegion[]; masks: Uint8Array[]; layer: Uint8Array | null }
interface Size { width: number; height: number }

const REGION_KEYS = ['height', 'rotation', 'shape', 'strength', 'style', 'width', 'x', 'y']
export function validVideoRegion(value: unknown, video: Size): value is VideoRegion {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  if (Object.keys(item).sort().join() !== REGION_KEYS.join()) return false
  if (![item.x, item.y, item.width, item.height, item.rotation].every(v => typeof v === 'number' && Number.isFinite(v))) return false
  const region = item as unknown as VideoRegion
  return region.width >= 1 && region.height >= 1 && region.width <= video.width * 4 && region.height <= video.height * 4
    && Math.abs(region.x) <= video.width * 4 && Math.abs(region.y) <= video.height * 4 && Math.abs(region.rotation) <= 36000
    && (region.style === 'blur' || region.style === 'mosaic') && (region.shape === 'ellipse' || region.shape === 'rect')
    && Number.isInteger(region.strength) && region.strength >= 1 && region.strength <= 100
    && !!regionBounds(region, video.width, video.height)
}
/** Shape check of the request before main reads the PNGs (sizes are checked against the decoded headers). */
export function validOverlayRequest(value: unknown, video?: Size): value is VideoOverlayRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  if (Object.keys(item).sort().join() !== 'layer,masks,regions' || !Array.isArray(item.regions) || !Array.isArray(item.masks)) return false
  if (item.regions.length > MAX_VIDEO_REGIONS || item.masks.length !== item.regions.length) return false
  if (!item.masks.every(mask => mask instanceof Uint8Array && mask.byteLength <= MAX_MASK_BYTES)) return false
  if (item.layer !== null && !(item.layer instanceof Uint8Array && item.layer.byteLength <= MAX_LAYER_BYTES)) return false
  if (!item.regions.length && item.layer === null) return false
  return !video || item.regions.every(region => validVideoRegion(region, video))
}
/** Width and height from a PNG's IHDR, or null when the bytes are not a PNG. */
export function pngSize(bytes: Uint8Array): Size | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < 33 || signature.some((value, i) => bytes[i] !== value) || String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}
/** The mask PNG of a region covers exactly its bounds (whole pixels, clipped to the video). */
export const maskBounds = (region: VideoRegion, video: Size): Rect => regionBounds(region, video.width, video.height)!

/** The blur/mosaic of one area, as ffmpeg filters on the crop of its source rectangle. Strength follows the photo editor. */
function effect(region: VideoRegion, source: Rect) {
  if (region.style === 'blur') return `gblur=sigma=${blurSigma(region).toFixed(2)}`
  // Block grid anchored at the video origin like the photo editor: the source rectangle starts on a block edge.
  const block = mosaicBlock(region)
  return `scale=${Math.ceil(source.width / block)}:${Math.ceil(source.height / block)}:flags=area,scale=${source.width}:${source.height}:flags=neighbor`
}
/**
 * Filter-graph text from label [from] to [to] (RGB frames at the full video size): each region in order, then the
 * sticker layer on top. `layerInput`/`maskInputs` are ffmpeg input numbers. Labels start with ov_ and are unique.
 */
export function overlayGraph(regions: VideoRegion[], video: Size, inputs: { layer: number | null; masks: number[] }, from: string, to: string): string {
  const parts: string[] = []
  let current = from
  regions.forEach((region, i) => {
    const bounds = maskBounds(region, video)
    const source = sourceRect({ ...region, id: '' }, bounds, video.width, video.height)
    const next = `ov_${i + 1}`
    parts.push(`[${current}]split[ov_b${i}][ov_r${i}]`,
      `[ov_r${i}]crop=${source.width}:${source.height}:${source.x}:${source.y},${effect(region, source)},crop=${bounds.width}:${bounds.height}:${bounds.x - source.x}:${bounds.y - source.y},format=rgba[ov_e${i}]`,
      `[${inputs.masks[i]}:v]format=gray[ov_m${i}]`,
      `[ov_e${i}][ov_m${i}]alphamerge[ov_a${i}]`,
      `[ov_b${i}][ov_a${i}]overlay=${bounds.x}:${bounds.y}:format=rgb[${next}]`)
    current = next
  })
  if (inputs.layer !== null) parts.push(`[${inputs.layer}:v]format=rgba[ov_l]`, `[${current}][ov_l]overlay=0:0:format=rgb[${to}]`)
  else parts.push(`[${current}]null[${to}]`)
  return parts.join(';')
}
/** Files written by main for one export, in ffmpeg input order after the video (layer first). */
export interface OverlayFiles { regions: VideoRegion[]; layer: string | null; masks: string[] }
/** `-f png_pipe` reads the file as one PNG (the image2 demuxer would treat % in a path as a frame pattern). */
export function overlayInputs(files: OverlayFiles | undefined): { args: string[]; layer: number | null; masks: number[] } {
  if (!files) return { args: [], layer: null, masks: [] }
  const paths = [...(files.layer ? [files.layer] : []), ...files.masks]
  return {
    args: paths.flatMap(path => ['-f', 'png_pipe', '-i', path]),
    layer: files.layer ? 1 : null,
    masks: files.masks.map((_, i) => i + 1 + (files.layer ? 1 : 0))
  }
}
