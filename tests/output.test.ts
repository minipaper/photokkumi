import { it, expect } from 'vitest'
import { DEFAULT_OUTPUT, outputSize, validOutput, outputKey } from '../src/shared/output'
it('원본·너비·종횡비 반올림·확대 방지를 계산한다', () => {
  expect(outputSize(1200, 801, DEFAULT_OUTPUT)).toEqual({ width: 1200, height: 801 })
  expect(outputSize(1200, 801, { ...DEFAULT_OUTPUT, width: 600 })).toEqual({ width: 600, height: 401 })
  expect(outputSize(400, 600, { ...DEFAULT_OUTPUT, width: 800 })).toEqual({ width: 400, height: 600 })
  expect(outputSize(400, 600, { ...DEFAULT_OUTPUT, width: 800, preventUpscale: false })).toEqual({ width: 800, height: 1200 })
})
it('너비·품질·픽셀 제한과 잘못된 설정을 거부한다', () => {
  for (const width of [0, -1, NaN, Infinity, 1.5, 8193]) {
    expect(validOutput({ ...DEFAULT_OUTPUT, width })).toBe(false)
  }
  for (const quality of [0, 1, 65, 90, 101, 1.5, NaN]) expect(validOutput({ ...DEFAULT_OUTPUT, quality })).toBe(false)
  expect(validOutput({ ...DEFAULT_OUTPUT, extra: true })).toBe(false)
  expect(validOutput({ ...DEFAULT_OUTPUT, preventUpscale: 'true' })).toBe(false)
  expect(validOutput({ ...DEFAULT_OUTPUT, format: 'webp' })).toBe(false)
  expect(() => outputSize(400, 600, { ...DEFAULT_OUTPUT, width: 8192, preventUpscale: false })).toThrow()
  expect(() => outputSize(4000, 3000, { ...DEFAULT_OUTPUT, width: 8000, preventUpscale: false })).toThrow()
  expect(outputKey(DEFAULT_OUTPUT)).toBe(outputKey({ ...DEFAULT_OUTPUT, quality: 1 }))
  expect(outputKey(DEFAULT_OUTPUT)).not.toBe(outputKey({ ...DEFAULT_OUTPUT, format: 'jpg' }))
})
