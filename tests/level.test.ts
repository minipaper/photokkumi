import { describe, it, expect } from 'vitest'
import { estimateTilt, type GrayImage } from '../src/shared/level'

/** Deterministic noise so failures reproduce. */
function random(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 } }
function image(width: number, height: number, shade: (x: number, y: number) => number): GrayImage {
  const data = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[y * width + x] = Math.max(0, Math.min(255, Math.round(shade(x + 0.5, y + 0.5))))
  return { data, width, height, channels: 1 }
}
/** Anti-aliased step: 0 on one side of the line, 1 on the other, a 1px ramp across it. */
const ramp = (distance: number) => Math.max(0, Math.min(1, distance + 0.5))
/** Sky above, ground below a horizon leaning `degrees` clockwise (right end lower), with texture noise. */
function horizon(degrees: number, width = 640, height = 480, noise = 18, seed = 7) {
  const next = random(seed), t = Math.tan(degrees * Math.PI / 180), cos = Math.cos(degrees * Math.PI / 180)
  return image(width, height, (x, y) => {
    const distance = (y - (height * 0.45 + (x - width / 2) * t)) * cos
    return 200 - 120 * ramp(distance) + (next() - 0.5) * noise
  })
}

describe('자동 수평', () => {
  it('기울어진 수평선의 각도를 0.2° 안으로 찾는다 (오른쪽이 내려가면 +)', () => {
    for (const degrees of [0, 0.7, -2.3, 4, -6.5, 9.8, -14]) {
      const result = estimateTilt(horizon(degrees, 640, 480, 18, Math.round(degrees * 10) + 100))
      expect(result, `${degrees}°`).not.toBeNull()
      expect(Math.abs(result!.tilt - degrees), `${degrees}° → ${result!.tilt}°`).toBeLessThanOrEqual(0.2)
    }
  })
  it('세로 사진·RGBA 입력, 건물 세로선만 있는 사진도 찾는다', () => {
    const portrait = horizon(3.2, 480, 640)
    expect(Math.abs(estimateTilt(portrait)!.tilt - 3.2)).toBeLessThanOrEqual(0.2)
    const rgba: GrayImage = { data: new Uint8Array(portrait.width * portrait.height * 4), width: portrait.width, height: portrait.height, channels: 4 }
    portrait.data.forEach((value, i) => rgba.data.set([value, value, value, 255], i * 4))
    expect(Math.abs(estimateTilt(rgba)!.tilt - 3.2)).toBeLessThanOrEqual(0.2)
    // Dark pillars leaning −5°: a vertical line turned clockwise by α leans its top to the right.
    const degrees = -5, t = Math.tan(degrees * Math.PI / 180), next = random(3)
    const pillars = image(640, 480, (x, y) => {
      const shifted = x + (y - 240) * t
      const near = Math.min(...[120, 260, 400, 520].map(center => Math.abs(shifted - center)))
      return 210 - 150 * ramp(6 - near) + (next() - 0.5) * 16
    })
    expect(Math.abs(estimateTilt(pillars)!.tilt - degrees)).toBeLessThanOrEqual(0.2)
  })
  it('올려다본 건물처럼 세로선이 모여 있어도 수평선을 따른다', () => {
    const degrees = 3, t = Math.tan(degrees * Math.PI / 180), next = random(5)
    const scene = image(640, 480, (x, y) => {
      // Pillars lean toward a vanishing point above the photo (−6°…+6°), the horizon leans 3°.
      const lean = [-6, -3, 3, 6].map((angle, i) => Math.abs(x - (110 + i * 140) - (y - 240) * Math.tan(angle * Math.PI / 180)))
      const pillar = ramp(4 - Math.min(...lean))
      const ground = ramp((y - (300 + (x - 320) * t)) * Math.cos(degrees * Math.PI / 180))
      return 210 - 90 * ground - 80 * pillar + (next() - 0.5) * 16
    })
    expect(Math.abs(estimateTilt(scene)!.tilt - degrees)).toBeLessThanOrEqual(0.3)
  })
  it('직선이 없거나(질감만, 둥근 물체) 범위 밖 대각선뿐이면 null', () => {
    const next = random(11)
    expect(estimateTilt(image(640, 480, () => 128 + (next() - 0.5) * 60))).toBeNull()
    const circle = image(640, 480, (x, y) => 220 - 160 * ramp(150 - Math.hypot(x - 320, y - 240)))
    expect(estimateTilt(circle)).toBeNull()
    const diagonal = image(640, 480, (x, y) => 220 - 160 * ramp(Math.abs((x - y) / Math.SQRT2) < 200 ? 1 : -1))
    expect(estimateTilt(diagonal)).toBeNull()
    expect(estimateTilt(image(8, 8, () => 0))).toBeNull()
  })
  it('640px 사진 한 장을 0.5초 안에 처리한다', () => {
    const photo = horizon(2, 640, 480)
    const start = performance.now()
    estimateTilt(photo)
    expect(performance.now() - start).toBeLessThan(500)
  })
})
