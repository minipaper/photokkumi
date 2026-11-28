import { expect, it } from 'vitest'
import { MAX_MP4_SECONDS, isMp4, mp4Args, mp4Width, pickH264Encoder, validMp4Options } from '../src/shared/video'
import { parseColor, toneMapFilter } from '../src/shared/hdr'

const ok = { start: 1, end: 61, width: 0, audio: true }
it(`MP4 옵션은 구간(최대 ${MAX_MP4_SECONDS / 60}분)·너비·소리·자르기를 검증한다`, () => {
  expect(validMp4Options(ok, 120)).toBe(true)
  expect(validMp4Options({ ...ok, width: 1280, audio: false, crop: { x: 0, y: 0, width: 1080, height: 1080 } }, 120)).toBe(true)
  expect(validMp4Options({ ...ok, start: 0, end: MAX_MP4_SECONDS }, 9999)).toBe(true)
  for (const bad of [{ ...ok, start: 0, end: MAX_MP4_SECONDS + 1 }, { ...ok, end: 121 }, { ...ok, width: 1000 }, { ...ok, audio: 1 }, { ...ok, fps: 10 },
    { ...ok, crop: { x: 0, y: 0, width: 8, height: 8 } }, { ...ok, start: Number.NaN }, null, [ok]]) expect(validMp4Options(bad, 120)).toBe(false)
})
it('H.264 인코더는 x264를 먼저, 없으면 Windows/macOS 시스템 인코더를 고른다', () => {
  const list = (...names: string[]) => `Encoders:\n V..... = Video\n ------\n${names.map(name => ` V....D ${name}              H.264 encoder`).join('\n')}\n A....D aac                  AAC`
  expect(pickH264Encoder(list('libx264rgb', 'h264_mf', 'libx264'))).toBe('libx264')
  expect(pickH264Encoder(list('libx264rgb', 'h264_mf'))).toBe('h264_mf')
  expect(pickH264Encoder(list('h264_videotoolbox'))).toBe('h264_videotoolbox')
  expect(pickH264Encoder(list('libopenh264x'))).toBeNull()
})
it('MP4 크기는 원본(자른 영역)보다 키우지 않고 짝수로 맞춘다', () => {
  expect(mp4Width({ width: 0 }, 1081)).toBe(1080)
  expect(mp4Width({ width: 1920 }, 1080)).toBe(1080)
  expect(mp4Width({ width: 720, crop: { x: 0, y: 0, width: 1001, height: 900 } }, 1920)).toBe(720)
  expect(mp4Width({ width: 0, crop: { x: 0, y: 0, width: 1001, height: 900 } }, 1920)).toBe(1000)
})
it('MP4 인자: 소리 유지/제거, 자르기→크기→BT.709, 메타데이터 제거, 빠른 시작', () => {
  const args = mp4Args('C:\\영상\\a b.mov', 'C:\\out\\.x.tmp', { ...ok, crop: { x: 241, y: 0, width: 1439, height: 1080 } }, { width: 1920, height: 1080, color: 'sdr' }, 'libx264')
  const at = (flag: string) => args[args.indexOf(flag) + 1]
  expect(at('-i')).toBe('C:\\영상\\a b.mov'); expect(args.at(-1)).toBe('C:\\out\\.x.tmp')
  expect([at('-ss'), at('-t')]).toEqual(['1.000', '60.000'])
  expect(at('-filter_complex')).toBe('[0:v]crop=1438:1080:240:0,scale=1438:-2:flags=lanczos,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[vout]')
  expect(args.join(' ')).toContain('-map [vout] -map 0:a:0?')
  expect(args.join(' ')).toContain('-map 0:a:0? -c:a aac -b:a 160k')
  expect(args).not.toContain('-an')
  expect(args.join(' ')).toContain('-c:v libx264 -preset medium -crf 20')
  expect(args.join(' ')).toContain('-colorspace bt709 -color_primaries bt709 -color_trc bt709')
  expect(args.join(' ')).toContain('-map_metadata -1 -map_chapters -1 -movflags +faststart -f mp4')
  const silent = mp4Args('in.mov', 'o', { ...ok, width: 1280, audio: false }, { width: 1920, height: 1080, color: 'hlg' }, 'h264_mf')
  expect(silent).toContain('-an'); expect(silent.join(' ')).not.toContain('0:a')
  expect(silent[silent.indexOf('-b:v') + 1]).toBe('4M')
  expect(silent[silent.indexOf('-filter_complex') + 1]).toMatch(/^\[0:v\]scale=1280:-2:flags=lanczos,scale=in_color_matrix=bt2020,.*,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p\[vout\]$/)
  expect(isMp4(new Uint8Array([0, 0, 0, 32, 0x66, 0x74, 0x79, 0x70]))).toBe(true); expect(isMp4(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]))).toBe(false)
})
it('ffmpeg 정보에서 HDR 곡선을 읽는다 (아이폰 HLG, 갤럭시 HDR10+ PQ)', () => {
  expect(parseColor('Stream #0:0[0x1](und): Video: hevc (Main 10) (hvc1 / 0x31637668), yuv420p10le(tv, bt2020nc/bt2020/arib-std-b67), 1920x1080')).toBe('hlg')
  expect(parseColor('Stream #0:0: Video: hevc (Main 10), yuv420p10le(tv, bt2020nc/bt2020/smpte2084), 3840x2160')).toBe('pq')
  expect(parseColor('Stream #0:0: Video: h264 (High), yuv420p(tv, bt709), 1920x1080\n Stream #0:1: Data: arib-std-b67')).toBe('sdr')
  expect(toneMapFilter('sdr')).toBe('')
  // ffmpeg filter-graph syntax: quoted lutrgb expressions, one split/blend pair with fixed labels.
  const hlg = toneMapFilter('hlg')
  expect(hlg.match(/'/g)!.length % 2).toBe(0)
  expect(hlg).toContain('split[hdr_c][hdr_l];[hdr_l]'); expect(toneMapFilter('pq')).not.toContain('split')
})
