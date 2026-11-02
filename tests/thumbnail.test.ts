import { it, expect } from 'vitest'
import { orientThumbnail } from '../src/shared/thumbnail'
it.each([
  [1, 2, 3, [1, 2, 3, 4, 5, 6]], [2, 2, 3, [2, 1, 4, 3, 6, 5]],
  [3, 2, 3, [6, 5, 4, 3, 2, 1]], [4, 2, 3, [5, 6, 3, 4, 1, 2]],
  [5, 3, 2, [1, 3, 5, 2, 4, 6]], [6, 3, 2, [5, 3, 1, 6, 4, 2]],
  [7, 3, 2, [6, 4, 2, 5, 3, 1]], [8, 3, 2, [2, 4, 6, 1, 3, 5]]
])('EXIF 방향 %i의 작은 RGBA/BGRA 썸네일 픽셀 순서', (orientation, width, height, pixels) => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 6].flatMap(value => [value, 20, 30, 255]))
  const result = orientThumbnail(bytes, 2, 3, orientation as number)
  expect([result.width, result.height]).toEqual([width, height])
  expect([...result.bytes].filter((_, index) => index % 4 === 0)).toEqual(pixels)
  expect([...result.bytes].filter((_, index) => index % 4 === 3)).toEqual([255, 255, 255, 255, 255, 255])
})
