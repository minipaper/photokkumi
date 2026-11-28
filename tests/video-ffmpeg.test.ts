import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chain, gifArgs, parseProbe } from '../src/shared/gif'
import { parseColor, toneMapFilter, type VideoColor } from '../src/shared/hdr'
import { mp4Args, pickH264Encoder } from '../src/shared/video'
import { maskBounds, type VideoRegion } from '../src/shared/video-overlay'
import { PNG } from 'pngjs'
import { writeFile } from 'node:fs/promises'

/** Runs against the developer's own ffmpeg; skipped where none is installed (the Windows CI runner). */
function findFfmpeg() {
  for (const candidate of [process.env.FFMPEG_PATH, 'ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'].filter(Boolean) as string[]) {
    const result = spawnSync(candidate, ['-hide_banner', '-version'], { encoding: 'utf8' })
    if (result.status === 0 && result.stdout.startsWith('ffmpeg version')) return candidate
  }
  return null
}
const ffmpeg = findFfmpeg()
/** Our own argument arrays already carry -hide_banner/-loglevel; `run` adds them for the test's helper commands. */
const exec = (args: string[], input?: Buffer) => {
  const result = spawnSync(ffmpeg!, args, { input, maxBuffer: 64 << 20 })
  if (result.status !== 0) throw new Error(result.stderr.toString())
  return result.stdout
}
const run = (args: string[], input?: Buffer) => exec(['-hide_banner', '-loglevel', 'error', ...args], input)
const probe = (path: string) => spawnSync(ffmpeg!, ['-hide_banner', '-i', path], { encoding: 'utf8' }).stderr

// SDR colours (meat red, skin, leaf, grey, shadow, brown, blue, yellow) as a phone would record them in HDR.
const COLOURS = [[0xb4, 0x28, 0x2d], [0xd9, 0xa0, 0x7a], [0x2e, 0x8b, 0x57], [0xc8, 0xc8, 0xc8], [0x40, 0x40, 0x40], [0x8a, 0x3a, 0x2a], [0x30, 0x50, 0xa0], [0xf0, 0xe0, 0x40]]
const TO_2020 = [[0.6274, 0.3293, 0.0433], [0.0691, 0.9195, 0.0114], [0.0164, 0.088, 0.8956]]
/** SDR code → BT.2020 display light relative to SDR white (203 nits). */
function light(rgb: number[]) {
  const linear = rgb.map(value => (value / 255) ** 2.4)
  return TO_2020.map(row => row.reduce((sum, weight, i) => sum + weight * linear[i], 0))
}
function hlgSignal(rgb: number[]) {
  // Display light on a 1000-nit HLG display, back through the OOTF (Y^0.2) and the OETF (BT.2100).
  const display = light(rgb).map(value => value * 0.203)
  const y = 0.2627 * display[0] + 0.678 * display[1] + 0.0593 * display[2]
  const scene = display.map(value => value * (y ** (1 / 1.2)) / y)
  const [a, b, c] = [0.17883277, 0.28466892, 0.55991073]
  return scene.map(e => e <= 1 / 12 ? Math.sqrt(3 * e) : a * Math.log(12 * e - b) + c)
}
function pqSignal(rgb: number[]) {
  const [m1, m2, c1, c2, c3] = [0.1593017578125, 78.84375, 0.8359375, 18.8515625, 18.6875]
  return light(rgb).map(value => { const l = (value * 203 / 10000) ** m1; return ((c1 + c2 * l) / (1 + c3 * l)) ** m2 })
}
const WIDTH = 320, HEIGHT = 64
/** Eight 40px colour bars, 10-bit BT.2020 tagged with the HDR curve, in a lossless FFV1 file every ffmpeg can write. */
function hdrClip(path: string, color: Exclude<VideoColor, 'sdr'>) {
  const row = Buffer.alloc(WIDTH * 6)
  for (let x = 0; x < WIDTH; x++) (color === 'hlg' ? hlgSignal : pqSignal)(COLOURS[Math.floor(x / 40)]).forEach((value, i) => row.writeUInt16LE(Math.round(value * 65535), x * 6 + i * 2))
  const frames = Buffer.concat(Array.from({ length: HEIGHT * 5 }, () => row))
  run(['-f', 'rawvideo', '-pix_fmt', 'rgb48le', '-s', `${WIDTH}x${HEIGHT}`, '-r', '5', '-i', 'pipe:0', '-vf',
    `scale=out_color_matrix=bt2020:out_range=tv,format=yuv420p10le,setparams=colorspace=bt2020nc:color_primaries=bt2020:color_trc=${color === 'hlg' ? 'arib-std-b67' : 'smpte2084'}:range=tv`,
    '-c:v', 'ffv1', '-y', path], frames)
}
/** Centre pixel of each bar after decoding through `filter`. */
function bars(path: string, filter: string) {
  const rgb = run(['-i', path, '-frames:v', '1', '-vf', chain(filter, 'format=rgb24'), '-f', 'rawvideo', 'pipe:1'])
  const width = rgb.length / 3 / HEIGHT
  return COLOURS.map((_, i) => { const at = ((HEIGHT / 2) * width + Math.floor((i + 0.5) * width / 8)) * 3; return [rgb[at], rgb[at + 1], rgb[at + 2]] })
}
const distance = (a: number[], b: number[]) => Math.max(...a.map((value, i) => Math.abs(value - b[i])))

describe.skipIf(!ffmpeg)('실제 ffmpeg로 동영상 색·자르기·소리 확인', () => {
  for (const color of ['hlg', 'pq'] as const) it(`${color.toUpperCase()} HDR 영상의 색을 SDR로 바르게 바꾼다 (빨강이 갈색으로 바래지 않음)`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pk-hdr-'))
    try {
      const clip = join(dir, 'clip.mkv')
      hdrClip(clip, color)
      expect(parseColor(probe(clip))).toBe(color)
      const fixed = bars(clip, toneMapFilter(color))
      fixed.forEach((rgb, i) => expect(distance(rgb, COLOURS[i]), `bar ${i}: ${rgb} vs ${COLOURS[i]}`).toBeLessThanOrEqual(6))
      // Without the conversion the meat red is visibly duller (the reported problem).
      expect(distance(bars(clip, '')[0], COLOURS[0])).toBeGreaterThan(20)
      // The whole GIF graph parses and keeps the colour.
      const gif = join(dir, 'o.gif')
      exec(gifArgs(clip, gif, { start: 0, end: 1, width: 320, fps: 5 }, { width: WIDTH, height: HEIGHT, color }))
      expect(distance(bars(gif, '')[0], COLOURS[0])).toBeLessThanOrEqual(10)
    } finally { await rm(dir, { recursive: true, force: true }) }
  }, 30_000)

  it('MP4: 자른 영역·크기, 소리 유지/제거, BT.709 표기, 위치 메타데이터 제거', async () => {
    const encoder = pickH264Encoder(spawnSync(ffmpeg!, ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout)
    if (!encoder) return
    const dir = await mkdtemp(join(tmpdir(), 'pk-mp4-'))
    try {
      // Left third red, the rest blue, with a tone and a GPS tag; we keep only the blue part.
      const clip = join(dir, 'clip.mov')
      run(['-f', 'lavfi', '-i', 'color=c=red:s=300x200:d=2,format=yuv420p[a];color=c=blue:s=600x200:d=2,format=yuv420p[b];[a][b]hstack', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
        '-c:v', 'libx264', '-c:a', 'aac', '-metadata', 'location=+37.5665+126.9780/', '-y', clip])
      expect(parseProbe(probe(clip))).toMatchObject({ width: 900, height: 200, hasAudio: true })
      const crop = { x: 300, y: 0, width: 600, height: 200 }
      for (const audio of [true, false]) {
        const out = join(dir, `${audio}.mp4`)
        exec(mp4Args(clip, out, { start: 0.5, end: 1.5, width: 0, audio, crop }, { width: 900, height: 200, color: 'sdr' }, encoder))
        const info = probe(out)
        expect(parseProbe(info)).toMatchObject({ width: 600, height: 200, hasAudio: audio })
        expect(info).toMatch(/bt709/); expect(info).not.toContain('location')
        expect(parseProbe(info).duration).toBeCloseTo(1, 0)
        expect((await readFile(out)).subarray(4, 8).toString('latin1')).toBe('ftyp')
        const [left] = bars(out, 'scale=320:64')
        expect(left[2]).toBeGreaterThan(200); expect(left[0]).toBeLessThan(40)
      }
    } finally { await rm(dir, { recursive: true, force: true }) }
  }, 60_000)

  it('가림·스티커: 2px 줄무늬 영상의 타원 안만 평평해지고, 스티커는 마지막 프레임까지 그대로', async () => {
    const encoder = pickH264Encoder(spawnSync(ffmpeg!, ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout)
    if (!encoder) return
    const dir = await mkdtemp(join(tmpdir(), 'pk-ov-'))
    try {
      const clip = join(dir, 'clip.mp4'), video = { width: 320, height: 240 }
      // Black/white 2px vertical stripes for 2s: any blur turns them grey.
      run(['-f', 'lavfi', '-i', 'color=c=white:s=320x240:r=10:d=2,geq=lum=\'if(mod(floor(X/2),2),235,16)\':cb=128:cr=128', '-c:v', 'libx264', '-crf', '0', '-pix_fmt', 'yuv444p', '-y', clip])
      const region: VideoRegion = { x: 100, y: 120, width: 120, height: 80, rotation: 0, style: 'blur', strength: 30, shape: 'ellipse' }
      const bounds = maskBounds(region, video)
      const mask = new PNG({ width: bounds.width, height: bounds.height })
      for (let y = 0; y < bounds.height; y++) for (let x = 0; x < bounds.width; x++) {
        const inside = ((x + 0.5 + bounds.x - region.x) / 60) ** 2 + ((y + 0.5 + bounds.y - region.y) / 40) ** 2 <= 1
        mask.data.set(inside ? [255, 255, 255, 255] : [0, 0, 0, 255], (y * bounds.width + x) * 4)
      }
      const layer = new PNG({ width: 320, height: 240 })
      for (let y = 20; y < 60; y++) for (let x = 240; x < 300; x++) layer.data.set([220, 20, 40, 255], (y * 320 + x) * 4)
      const files = { regions: [region], layer: join(dir, 'layer 100%d.png'), masks: [join(dir, 'mask.png')] }
      await writeFile(files.layer, PNG.sync.write(layer)); await writeFile(files.masks[0], PNG.sync.write(mask))
      const out = join(dir, 'o.mp4')
      exec(mp4Args(clip, out, { start: 0, end: 2, width: 0, audio: false }, { ...video, color: 'sdr' }, encoder, files))
      const frame = (time: number) => run(['-ss', String(time), '-i', out, '-frames:v', '1', '-vf', 'format=gray', '-f', 'rawvideo', 'pipe:1'])
      for (const time of [0, 1.8]) {
        const gray = frame(time), at = (x: number, y: number) => gray[y * 320 + x]
        const inside = [96, 97, 98, 99, 100, 101].map(x => at(x, 120)), outside = [10, 11, 12, 13].map(x => at(x, 120))
        expect(Math.max(...inside) - Math.min(...inside), `${time}s inside ${inside}`).toBeLessThan(30)
        expect(Math.max(...outside) - Math.min(...outside), `${time}s outside ${outside}`).toBeGreaterThan(150)
        // Corner of the bounds outside the ellipse keeps the stripes.
        const corner = [0, 1, 2, 3].map(x => at(bounds.x + 1 + x, bounds.y + 1))
        expect(Math.max(...corner) - Math.min(...corner), `${time}s corner ${corner}`).toBeGreaterThan(150)
        const red = run(['-ss', String(time), '-i', out, '-frames:v', '1', '-vf', 'crop=2:2:270:40,scale=1:1,format=rgb24', '-f', 'rawvideo', 'pipe:1'])
        expect(red[0]).toBeGreaterThan(180); expect(red[1]).toBeLessThan(60)
      }
    } finally { await rm(dir, { recursive: true, force: true }) }
  }, 60_000)
})
