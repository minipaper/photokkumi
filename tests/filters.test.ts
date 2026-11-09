import { expect, it } from 'vitest'
import { applyAdjustments, validAdjustments, NEUTRAL_ADJUSTMENTS, isNeutral } from '../src/shared/filters'
import { setAdjustments, emptyHistory } from '../src/shared/scene'

const run = (rgba: number[], adjust: Partial<typeof NEUTRAL_ADJUSTMENTS>) => {
  const data = new Uint8ClampedArray(rgba); applyAdjustments(data, { ...NEUTRAL_ADJUSTMENTS, ...adjust }); return [...data]
}
it('0 값은 픽셀을 그대로 두고 알파는 어떤 보정에도 바뀌지 않는다', () => {
  const pixels = [0, 0, 0, 255, 12, 128, 250, 77, 255, 255, 255, 0]
  expect(run(pixels, {})).toEqual(pixels)
  const changed = run(pixels, { exposure: 40, contrast: -30, saturation: 50, temperature: 20 })
  expect([changed[3], changed[7], changed[11]]).toEqual([255, 77, 0])
})
it('노출은 밝기를, 대비는 중간 회색 기준 차이를, 채도는 회색은 유지하고 색을 바꾼다', () => {
  const gray = [128, 128, 128, 255]
  expect(run(gray, { exposure: 50 })[0]).toBeGreaterThan(165)
  expect(run(gray, { exposure: -50 })[0]).toBeLessThan(100)
  expect(run([255, 255, 255, 255], { exposure: 100 }).slice(0, 3)).toEqual([255, 255, 255])
  const contrast = run([64, 64, 64, 255, 192, 192, 192, 255], { contrast: 60 })
  expect(contrast[0]).toBeLessThan(40); expect(contrast[4]).toBeGreaterThan(215)
  expect(run([64, 64, 64, 255], { contrast: -100 })[0]).toBeGreaterThan(110)
  expect(run(gray, { saturation: 100 }).slice(0, 3)).toEqual([128, 128, 128])
  const muted = run([200, 100, 50, 255], { saturation: -100 })
  expect(muted[0]).toBe(muted[1]); expect(muted[1]).toBe(muted[2])
  const vivid = run([200, 100, 50, 255], { saturation: 50 })
  expect(vivid[0] - vivid[2]).toBeGreaterThan(150)
})
it('색온도 +는 따뜻하게(R↑ B↓), −는 차갑게', () => {
  const warm = run([128, 128, 128, 255], { temperature: 60 }), cool = run([128, 128, 128, 255], { temperature: -60 })
  expect(warm[0]).toBeGreaterThan(warm[2] + 20); expect(cool[2]).toBeGreaterThan(cool[0] + 20)
})
it('보정 값은 -100~100 정수 4개만 허용하고 장면에 저장한다', () => {
  expect(validAdjustments(NEUTRAL_ADJUSTMENTS)).toBe(true)
  for (const bad of [null, [], { ...NEUTRAL_ADJUSTMENTS, exposure: 101 }, { ...NEUTRAL_ADJUSTMENTS, contrast: 1.5 }, { ...NEUTRAL_ADJUSTMENTS, extra: 0 }, { exposure: 0 }])
    expect(validAdjustments(bad)).toBe(false)
  const scene = setAdjustments(emptyHistory().present, { ...NEUTRAL_ADJUSTMENTS, saturation: 30 })
  expect(scene.adjust.saturation).toBe(30); expect(isNeutral(emptyHistory().present.adjust)).toBe(true)
  expect(() => setAdjustments(scene, { ...NEUTRAL_ADJUSTMENTS, exposure: -101 })).toThrow()
})
