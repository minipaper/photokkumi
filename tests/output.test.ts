import { it, expect } from 'vitest'
import { DEFAULT_OUTPUT, outputSize, validOutput, outputKey } from '../src/shared/output'
it('원본과 가로1600·세로900 기본값 및 긴 축 기준을 계산한다', () => {
  expect(outputSize(2400, 1600, DEFAULT_OUTPUT)).toEqual({ width: 2400, height: 1600 })
  const enabled = { ...DEFAULT_OUTPUT, resizeEnabled: true }
  expect(outputSize(2400, 1600, enabled)).toEqual({ width: 1600, height: 1067 })
  expect(outputSize(1600, 2400, enabled)).toEqual({ width: 900, height: 1350 })
  expect(outputSize(1600, 2400, { ...enabled, resizeBasis: 'longEdge' })).toEqual({ width: 600, height: 900 })
  expect(outputSize(400, 600, enabled)).toEqual({ width: 400, height: 600 })
  expect(outputSize(400, 600, { ...enabled, portraitSize: 800, preventUpscale: false })).toEqual({ width: 800, height: 1200 })
  expect(outputSize(1200, 801, { ...enabled, landscapeSize: 600 })).toEqual({ width: 600, height: 401 })
})
it('길이·품질·픽셀 제한과 잘못된 설정을 거부한다', () => {
  for (const length of [0, -1, NaN, Infinity, 1.5, 8193]) {
    expect(validOutput({ ...DEFAULT_OUTPUT, landscapeSize: length })).toBe(false)
    expect(validOutput({ ...DEFAULT_OUTPUT, portraitSize: length })).toBe(false)
  }
  for (const quality of [0, 1, 65, 90, 101, 1.5, NaN]) expect(validOutput({ ...DEFAULT_OUTPUT, quality })).toBe(false)
  for (const bad of [{ extra: true }, { preventUpscale: 'true' }, { format: 'webp' }, { resizeBasis: 'height' }, { resizeEnabled: 1 }]) expect(validOutput({ ...DEFAULT_OUTPUT, ...bad })).toBe(false)
  expect(() => outputSize(4000, 3000, { ...DEFAULT_OUTPUT, resizeEnabled: true, landscapeSize: 8000, preventUpscale: false })).toThrow()
  expect(outputKey(DEFAULT_OUTPUT)).toBe(outputKey({ ...DEFAULT_OUTPUT, landscapeSize: 2000, portraitSize: 1000 }))
  expect(outputKey(DEFAULT_OUTPUT)).not.toBe(outputKey({ ...DEFAULT_OUTPUT, resizeEnabled: true }))
})
