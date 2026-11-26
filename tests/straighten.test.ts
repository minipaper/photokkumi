import { describe, it, expect } from 'vitest'
import { MAX_STRAIGHTEN, coverScale, normalizeStraighten, validStraighten } from '../src/shared/straighten'

describe('기울기', () => {
  it('±45° 안의 0.1° 단위만 받고 0은 저장하지 않는다', () => {
    expect(MAX_STRAIGHTEN).toBe(45)
    for (const value of [undefined, 0.1, -0.1, 12.3, 45, -45]) expect(validStraighten(value)).toBe(true)
    for (const value of [0, 45.1, -46, 0.05, 1.23, Number.NaN, Infinity, '1', null]) expect(validStraighten(value)).toBe(false)
    expect(normalizeStraighten(12.34)).toBe(12.3)
    expect(normalizeStraighten(-0.04)).toBeUndefined()
    expect(normalizeStraighten(0)).toBeUndefined()
    expect(normalizeStraighten(60)).toBe(45)
    expect(normalizeStraighten(-99)).toBe(-45)
    expect(normalizeStraighten(Number.NaN)).toBeUndefined()
  })
  it('빈 귀퉁이가 없을 만큼만 확대한다: 0°는 1배, 각도·가로세로 비가 클수록 커진다', () => {
    const landscape = { width: 1200, height: 900 }
    expect(coverScale(landscape, undefined)).toBe(1)
    expect(coverScale(landscape, 15)).toBeCloseTo(Math.cos(Math.PI / 12) + 4 / 3 * Math.sin(Math.PI / 12), 10)
    expect(coverScale(landscape, 15)).toBeCloseTo(1.311, 3)
    expect(coverScale(landscape, 45)).toBeCloseTo(1.65, 2)
    // Direction does not matter, and a portrait frame needs the same enlargement as its landscape twin.
    expect(coverScale(landscape, -15)).toBe(coverScale(landscape, 15))
    expect(coverScale({ width: 900, height: 1200 }, 15)).toBeCloseTo(coverScale(landscape, 15), 10)
    expect(coverScale({ width: 1000, height: 1000 }, 45)).toBeCloseTo(Math.SQRT2, 10)
  })
  it('확대한 기울어진 사진이 틀의 네 귀퉁이를 모두 덮는다', () => {
    for (const size of [{ width: 1200, height: 800 }, { width: 600, height: 900 }, { width: 4000, height: 1000 }]) {
      for (const degrees of [0.1, 3, -7.5, 20, 45, -45]) {
        const scale = coverScale(size, degrees), angle = degrees * Math.PI / 180
        for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          // A frame corner, turned back into the photo's own axes, must lie inside the enlarged photo.
          const x = cx * size.width / 2, y = cy * size.height / 2
          const u = x * Math.cos(-angle) - y * Math.sin(-angle), v = x * Math.sin(-angle) + y * Math.cos(-angle)
          expect(Math.abs(u)).toBeLessThanOrEqual(scale * size.width / 2 + 1e-6)
          expect(Math.abs(v)).toBeLessThanOrEqual(scale * size.height / 2 + 1e-6)
        }
      }
    }
  })
})
