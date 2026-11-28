/**
 * HDR phone videos (iPhone HLG / Dolby Vision 8.4, Galaxy HDR10+ PQ) store BT.2020 colours with an HDR curve.
 * GIF, JPEG previews and our H.264 output are SDR BT.709, so ffmpeg must convert, or reds turn brown and
 * everything looks washed out. Uses only filters in every ffmpeg build (lutrgb, colorchannelmixer, blend);
 * zscale/tonemap need libzimg, which many builds lack. See docs/video.md.
 */
export type VideoColor = 'sdr' | 'hlg' | 'pq'
/** Reads the transfer curve from the video stream line of `ffmpeg -i`, e.g. `yuv420p10le(tv, bt2020nc/bt2020/arib-std-b67)`. */
export function parseColor(stderr: string): VideoColor {
  const video = /Stream #[^\n]*Video:[^\n]*/.exec(stderr)?.[0] ?? ''
  return /arib-std-b67/.test(video) ? 'hlg' : /smpte2084/.test(video) ? 'pq' : 'sdr'
}
const v = 'val/maxval'
/** HLG inverse OETF (BT.2100): signal → scene light 0…1. */
const HLG = `clip(if(lte(${v},0.5),pow(${v},2)/3,(exp((${v}-0.55991073)/0.17883277)+0.28466892)/12),0,1)*maxval`
/** HLG OOTF on a 1000-nit display: display light = scene light × Y^0.2 (Y = BT.2020 luminance), done as a multiply. */
const LUMA = ['r', 'g', 'b'].map(c => `${c}r=0.2627:${c}g=0.678:${c}b=0.0593`).join(':')
const OOTF = `pow(${v},0.2)*maxval`
/** PQ inverse EOTF (SMPTE ST 2084): signal → nits / 10000, kept as nits / 1000 (brighter is clipped before tone mapping). */
const PQ_N = `pow(${v},1/78.84375)`
const PQ = `clip(pow(max(${PQ_N}-0.8359375,0)/(18.8515625-18.6875*${PQ_N}),1/0.1593017578125)*10,0,1)*maxval`
/** Linear BT.2020 → BT.709 primaries; out-of-gamut parts clip at 0. */
const GAMUT = 'colorchannelmixer=rr=1.6605:rg=-0.5876:rb=-0.0728:gr=-0.1246:gg=1.1329:gb=-0.0083:br=-0.0182:bg=-0.1006:bb=1.1187'
/**
 * 1000 nits → 4.926 × SDR white (203 nits, BT.2408). Up to 75% of white passes unchanged; brighter parts roll off
 * smoothly toward white instead of clipping. Then BT.709 display gamma (2.4).
 */
const x = `${v}*4.926`
const TONE = `pow(if(lte(${x},0.75),${x},0.75+0.25*(1-exp(-(${x}-0.75)/0.25))),1/2.4)*maxval`
const lut = (expr: string) => `lutrgb=r='${expr}':g='${expr}':b='${expr}'`
/**
 * Filter-graph text that turns HDR frames into SDR BT.709 RGB (16-bit), or '' for SDR. It may use the labels
 * hdr_c/hdr_l/hdr_f, so put it once per graph, in a linear chain (… ,${toneMap},…).
 */
export function toneMapFilter(color: VideoColor): string {
  if (color === 'sdr') return ''
  const rgb = 'scale=in_color_matrix=bt2020,format=gbrp16le'
  if (color === 'pq') return [rgb, lut(PQ), GAMUT, lut(TONE)].join(',')
  return `${rgb},${lut(HLG)},split[hdr_c][hdr_l];[hdr_l]colorchannelmixer=${LUMA},${lut(OOTF)}[hdr_f];[hdr_c][hdr_f]blend=all_mode=multiply,${GAMUT},${lut(TONE)}`
}
