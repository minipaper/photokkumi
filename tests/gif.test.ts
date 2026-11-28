import { expect, it } from 'vitest'
import { cropFits, cropFilter, validGifOptions, gifFrameCount, previewFps, gifArgs, parseProbe, splitJpegs, parseProgress, previewArgs } from '../src/shared/gif'

it('GIF 옵션은 구간·너비·FPS·길이·프레임 한도를 검증한다', () => {
  const ok = { start: 1, end: 4.5, width: 480, fps: 12 }
  expect(validGifOptions(ok, 10)).toBe(true)
  expect(validGifOptions({ ...ok, start: 0, end: 30.5 }, 60)).toBe(false); expect(validGifOptions({ start: 0, end: 30, width: 320, fps: 20 }, 60)).toBe(true)
  expect(gifFrameCount(ok)).toBe(42)
  for (const bad of [{ ...ok, end: 1.05 }, { ...ok, start: -1 }, { ...ok, end: 11 }, { ...ok, width: 500 }, { ...ok, fps: 60 },
    { ...ok, start: 0, end: 30.5 }, { ...ok, start: Number.NaN }, { ...ok, extra: 1 }, null, [ok]]) expect(validGifOptions(bad, 10)).toBe(false)
})
it('미리보기 FPS는 긴 동영상일수록 줄여 프레임 수를 제한한다', () => {
  expect(previewFps(5)).toBe(10); expect(previewFps(60)).toBe(5); expect(previewFps(600)).toBe(0.5); expect(previewFps(100000)).toBe(0.2)
  expect(previewArgs('in.mov', 5)).toContain('fps=5,scale=640:-2')
})
it('ffmpeg 인자는 shell 없이 쓰는 고정 배열이며 원본보다 크게 만들지 않는다', () => {
  const args = gifArgs('C:\\사진\\a b.mov', 'C:\\tmp\\o.gif', { start: 1.25, end: 3, width: 640, fps: 10 }, { width: 360, color: 'sdr' })
  expect(args.slice(args.indexOf('-ss'), args.indexOf('-ss') + 4)).toEqual(['-ss', '1.250', '-t', '1.750'])
  expect(args[args.indexOf('-i') + 1]).toBe('C:\\사진\\a b.mov')
  expect(args[args.indexOf('-filter_complex') + 1]).toContain('[0:v]fps=10,scale=360:-1:flags=lanczos,format=rgb24,split')
  expect(args[args.indexOf('-frames:v') + 1]).toBe('18')
  expect(args.at(-1)).toBe('C:\\tmp\\o.gif')
})
it('ffmpeg 정보에서 길이와 회전 적용 크기를 읽는다', () => {
  const iphone = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'IMG_0001.MOV':
  Duration: 00:01:02.53, start: 0.000000, bitrate: 8012 kb/s
  Stream #0:0[0x1](und): Video: hevc (Main) (hvc1 / 0x31637668), yuv420p(tv, bt709), 1920x1080, 7880 kb/s, 29.98 fps
      Side data:
        displaymatrix: rotation of -90.00 degrees
  Stream #0:1[0x2](und): Audio: aac (LC)`
  expect(parseProbe(iphone)).toEqual({ duration: 62.53, width: 1080, height: 1920, hasAudio: true, color: 'sdr' })
  expect(parseProbe('Duration: 00:00:05.00, start\n  Stream #0:0: Video: h264, yuv420p, 640x480 [SAR 1:1 DAR 4:3], 30 fps')).toEqual({ duration: 5, width: 640, height: 480, hasAudio: false, color: 'sdr' })
  expect(() => parseProbe('Duration: N/A\nStream #0:0: Audio: aac')).toThrow()
})
it('MJPEG 스트림을 JPEG 단위로 나누고 진행 시간을 읽는다', () => {
  const jpeg = (body: number[]) => [0xff, 0xd8, ...body, 0xff, 0xd9]
  const frames = splitJpegs(new Uint8Array([...jpeg([1, 0xff, 0x00, 2]), ...jpeg([3]), 0xff, 0xd8, 9]))
  expect(frames.map(frame => [...frame])).toEqual([jpeg([1, 0xff, 0x00, 2]), jpeg([3])])
  expect(parseProgress('frame=3\nout_time_us=1500000\nprogress=continue\nout_time_us=2250000\n')).toBe(2.25)
  expect(parseProgress('frame=1')).toBeNull()
})

it('자르기는 영상 안의 정수 영역(16px 이상)만 받고, ffmpeg에는 짝수로 넘긴다', () => {
  const ok = { start: 0, end: 2, width: 480, fps: 12 }, crop = { x: 101, y: 0, width: 641, height: 720 }
  expect(validGifOptions({ ...ok, crop }, 10)).toBe(true)
  for (const bad of [{ ...crop, x: -1 }, { ...crop, width: 15 }, { ...crop, y: 0.5 }, { ...crop, extra: 1 }, [1, 2, 3, 4], null])
    expect(validGifOptions({ ...ok, crop: bad }, 10)).toBe(false)
  expect(cropFits(crop, { width: 742, height: 720 })).toBe(true); expect(cropFits(crop, { width: 741, height: 720 })).toBe(false)
  expect(cropFilter(crop)).toEqual(['crop=640:720:100:0']); expect(cropFilter(undefined)).toEqual([])
  // Crop first (display pixels, after ffmpeg's autorotate), and the GIF is never wider than the crop.
  const args = gifArgs('in.mov', 'o.gif', { ...ok, width: 800, crop }, { width: 1280, color: 'sdr' })
  expect(args[args.indexOf('-filter_complex') + 1]).toMatch(/^\[0:v\]crop=640:720:100:0,fps=12,scale=640:-1:flags=lanczos,/)
})
it('HDR 영상(HLG·PQ)은 GIF·미리보기 모두 SDR로 바꾼다', () => {
  const hlg = gifArgs('in.mov', 'o.gif', { start: 0, end: 1, width: 320, fps: 10 }, { width: 1080, color: 'hlg' })
  expect(hlg[hlg.indexOf('-filter_complex') + 1]).toMatch(/scale=320:-1:flags=lanczos,scale=in_color_matrix=bt2020,format=gbrp16le,lutrgb=.*blend=all_mode=multiply,colorchannelmixer=.*,format=rgb24,split\[a\]\[b\]/)
  expect(previewArgs('in.mov', 5, 'pq').join(' ')).toMatch(/fps=5,scale=640:-2,scale=in_color_matrix=bt2020,format=gbrp16le,lutrgb/)
})
