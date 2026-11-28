import { expect, it } from 'vitest'
import { MAX_VIDEO_REGIONS, maskBounds, overlayGraph, overlayInputs, pngSize, validOverlayRequest, validVideoRegion, type VideoRegion } from '../src/shared/video-overlay'
import { gifArgs } from '../src/shared/gif'
import { mp4Args } from '../src/shared/video'

const video = { width: 1920, height: 1080 }
const blur: VideoRegion = { x: 300, y: 200, width: 200, height: 100, rotation: 0, style: 'blur', strength: 40, shape: 'ellipse' }
const mosaic: VideoRegion = { x: 1900, y: 1000, width: 100, height: 100, rotation: 30, style: 'mosaic', strength: 50, shape: 'rect' }
const png = (width: number, height: number) => { const bytes = new Uint8Array(33); bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]); new DataView(bytes.buffer).setUint32(16, width); new DataView(bytes.buffer).setUint32(20, height); return bytes }

it('가림 영역은 정해진 키·유한한 값·영상과 겹치는 위치만 받는다', () => {
  expect(validVideoRegion(blur, video)).toBe(true); expect(validVideoRegion(mosaic, video)).toBe(true)
  for (const bad of [{ ...blur, x: 5000, y: 5000 }, { ...blur, x: -300 }, { ...blur, strength: 0 }, { ...blur, strength: 2.5 }, { ...blur, style: 'paint' }, { ...blur, shape: 'star' },
    { ...blur, width: Number.NaN }, { ...blur, id: 'x' }, { ...blur, width: 0 }, null, [blur]]) expect(validVideoRegion(bad, video)).toBe(false)
})
it('요청은 영역 수만큼 마스크, 크기 한도, 스티커 층은 PNG 하나 또는 없음', () => {
  const ok = { regions: [blur], masks: [png(1, 1)], layer: null }
  expect(validOverlayRequest(ok, video)).toBe(true)
  expect(validOverlayRequest({ regions: [], masks: [], layer: png(1, 1) }, video)).toBe(true)
  for (const bad of [{ ...ok, masks: [] }, { ...ok, masks: ['x'] }, { regions: [], masks: [], layer: null }, { ...ok, layer: [1] }, { ...ok, extra: 1 },
    { regions: Array(MAX_VIDEO_REGIONS + 1).fill(blur), masks: Array(MAX_VIDEO_REGIONS + 1).fill(png(1, 1)), layer: null }]) expect(validOverlayRequest(bad, video)).toBe(false)
  expect(pngSize(png(640, 360))).toEqual({ width: 640, height: 360 }); expect(pngSize(new Uint8Array(40))).toBeNull()
})
it('영역마다 원본 범위를 잘라 블러/모자이크 → 마스크로 모양 → 같은 자리에 얹고, 스티커 층은 맨 위', () => {
  const inputs = overlayInputs({ regions: [blur, mosaic], layer: '/t/l.png', masks: ['/t/a%d.png', '/t/b.png'] })
  expect(inputs.args).toEqual(['-f', 'png_pipe', '-i', '/t/l.png', '-f', 'png_pipe', '-i', '/t/a%d.png', '-f', 'png_pipe', '-i', '/t/b.png'])
  expect([inputs.layer, inputs.masks]).toEqual([1, [2, 3]])
  const graph = overlayGraph([blur, mosaic], video, inputs, 'ov_0', 'ov_out')
  // Blur: bounds 200×100 at (200,150), 3σ margin (σ = 100 × 0.4 × 0.15 = 6 → 18px).
  expect(maskBounds(blur, video)).toEqual({ x: 200, y: 150, width: 200, height: 100 })
  expect(graph).toContain('[ov_r0]crop=236:136:182:132,gblur=sigma=6.00,crop=200:100:18:18,format=rgba[ov_e0];[2:v]format=gray[ov_m0]')
  expect(graph).toContain('[ov_b0][ov_a0]overlay=200:150:format=rgb[ov_1]')
  // Mosaic: block 100 × 0.5 × 0.25 = 13px, source on the 13px grid and clipped at the frame edge.
  expect(graph).toMatch(/\[ov_r1\]crop=\d+:\d+:\d+:\d+,scale=\d+:\d+:flags=area,scale=\d+:\d+:flags=neighbor,crop=/)
  expect(graph.endsWith('[1:v]format=rgba[ov_l];[ov_2][ov_l]overlay=0:0:format=rgb[ov_out]')).toBe(true)
  expect(overlayGraph([blur], video, { layer: null, masks: [1] }, 'ov_0', 'ov_out').endsWith('[ov_1]null[ov_out]')).toBe(true)
})
it('가림·스티커가 있으면 전체 크기에서 먼저 얹고, 그다음 자르기·크기 (GIF·MP4 공통)', () => {
  const files = { regions: [blur], layer: '/t/l.png', masks: ['/t/m.png'] }
  const gif = gifArgs('in.mov', 'o.gif', { start: 0, end: 2, width: 480, fps: 12, crop: { x: 0, y: 0, width: 1080, height: 1080 } }, { ...video, color: 'hlg' }, files)
  const graph = gif[gif.indexOf('-filter_complex') + 1]
  expect(graph).toMatch(/^\[0:v\]fps=12,scale=in_color_matrix=bt2020,.*,format=rgb24\[ov_0\];\[ov_0\]split/)
  expect(graph).toContain('[ov_out]crop=1080:1080:0:0,scale=480:-1:flags=lanczos,format=rgb24,split[a][b]')
  expect(gif.slice(gif.indexOf('-i'), gif.indexOf('-an'))).toEqual(['-i', 'in.mov', '-f', 'png_pipe', '-i', '/t/l.png', '-f', 'png_pipe', '-i', '/t/m.png'])
  const mp4 = mp4Args('in.mov', 'o', { start: 0, end: 2, width: 0, audio: true }, { ...video, color: 'sdr' }, 'libx264', files)
  expect(mp4[mp4.indexOf('-filter_complex') + 1]).toMatch(/^\[0:v\]format=rgb24\[ov_0\];.*\[ov_out\]scale=1920:-2:flags=lanczos,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p\[vout\]$/)
  // Only the video's sound is used, never the PNG inputs.
  expect(mp4.join(' ')).toContain('-map [vout] -map 0:a:0?')
})
