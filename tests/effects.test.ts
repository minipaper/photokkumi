import { expect, it } from 'vitest'
import { blurPixels, mosaicPixels, regionBounds, sourceRect, regionPatch, blurSigma, mosaicBlock } from '../src/shared/effects'
import { addRegion, clearRegions, updateSelectedRegion, updateSelected, duplicateSelected, removeSelected, addInstance, emptyHistory } from '../src/shared/scene'
import type { BlurRegion } from '../src/shared/model'

const pixels = (width: number, height: number, value: (x: number, y: number) => number[]) => {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(value(x, y), (y * width + x) * 4)
  return { data, width, height }
}
const region: BlurRegion = { id: 'r', x: 50, y: 40, width: 40, height: 20, rotation: 0, style: 'blur', strength: 50 }

it('회전한 타원의 경계를 사진 안으로 자르고 완전히 벗어나면 null', () => {
  expect(regionBounds(region, 200, 100)).toEqual({ x: 30, y: 30, width: 40, height: 20 })
  expect(regionBounds({ ...region, rotation: 90 }, 200, 100)).toEqual({ x: 40, y: 20, width: 20, height: 40 })
  expect(regionBounds({ ...region, x: 5 }, 200, 100)).toMatchObject({ x: 0, width: 25 })
  expect(regionBounds({ ...region, x: -100 }, 200, 100)).toBeNull()
})

it('블러는 평탄한 영역을 유지하고 경계를 부드럽게 하며 가장자리는 어두워지지 않는다', () => {
  const flat = pixels(20, 10, () => [100, 150, 200, 255])
  expect([...blurPixels(flat, 3)]).toEqual([...flat.data])
  const edge = blurPixels(pixels(20, 1, x => x < 10 ? [0, 0, 0, 255] : [255, 255, 255, 255]), 2)
  expect(edge[0]).toBe(0); expect(edge[19 * 4]).toBe(255)
  expect(edge[9 * 4]).toBeGreaterThan(40); expect(edge[10 * 4]).toBeLessThan(215)
})

it('모자이크는 사진 격자 블록의 평균으로 칠하고 영역을 옮겨도 격자는 고정된다', () => {
  const source = pixels(4, 2, x => x < 2 ? [0, 0, 0, 255] : [100, 100, 100, 255])
  const result = mosaicPixels(source, 4, { x: 0, y: 0 })
  for (let i = 0; i < 8; i++) expect([...result.subarray(i * 4, i * 4 + 4)]).toEqual([50, 50, 50, 255])
  const shifted = mosaicPixels(pixels(4, 1, x => [x * 10, 0, 0, 255]), 2, { x: 1, y: 0 })
  expect([shifted[0], shifted[4], shifted[8], shifted[12]]).toEqual([0, 15, 15, 30])
})

it('패치는 필요한 주변 픽셀을 포함한 원본 영역에서 계산하고 강도를 짧은 변 기준으로 정한다', () => {
  expect(blurSigma(region)).toBeCloseTo(1.5); expect(mosaicBlock({ ...region, strength: 100 })).toBe(5)
  const photo = pixels(200, 100, x => [x, 0, 0, 255])
  const bounds = regionBounds(region, 200, 100)!
  const blurSource = sourceRect(region, bounds, 200, 100)
  expect(blurSource).toEqual({ x: 25, y: 25, width: 50, height: 30 })
  const crop = pixels(blurSource.width, blurSource.height, (x, y) => [...photo.data.subarray(((y + blurSource.y) * 200 + x + blurSource.x) * 4, ((y + blurSource.y) * 200 + x + blurSource.x) * 4 + 4)])
  const patch = regionPatch(region, crop, blurSource, bounds)
  expect([patch.width, patch.height]).toEqual([40, 20])
  expect(patch.data[(10 * 40 + 20) * 4]).toBeCloseTo(50, -0.5)
  const mosaic = { ...region, style: 'mosaic' as const, strength: 100 }
  expect(sourceRect(mosaic, bounds, 200, 100)).toEqual({ x: 30, y: 30, width: 40, height: 20 })
})

it('블러 영역은 스티커와 별도로 추가·수정·복제·삭제되고 잘못된 값을 거부한다', () => {
  let scene = addInstance(emptyHistory().present, { id: 's', assetId: 'a', x: 1, y: 1, width: 10, height: 10, rotation: 0, zOrder: 0 })
  scene = addRegion(scene, region)
  expect(scene.selectedId).toBe('r')
  scene = updateSelected(scene, { x: 70, y: 40, width: 30, height: 30, rotation: 15 })
  expect(scene.regions[0]).toMatchObject({ x: 70, width: 30, rotation: 15 }); expect(scene.stickers[0].x).toBe(1)
  scene = updateSelectedRegion(scene, { style: 'mosaic', strength: 80 })
  expect(scene.regions[0]).toMatchObject({ style: 'mosaic', strength: 80 })
  scene = duplicateSelected(scene, 'r2')
  expect(scene.regions.map(item => item.id)).toEqual(['r', 'r2']); expect(scene.regions[1].x).toBe(90)
  scene = removeSelected(scene)
  expect(scene.regions.map(item => item.id)).toEqual(['r']); expect(scene.stickers).toHaveLength(1); expect(scene.selectedId).toBe('r')
  expect(() => addRegion(scene, region)).toThrow()
  expect(() => addRegion(scene, { ...region, id: 'x', strength: 0 })).toThrow()
  expect(() => addRegion(scene, { ...region, id: 'x', width: 0 })).toThrow()
  expect(() => updateSelectedRegion(scene, { style: 'mosaic', strength: 101 })).toThrow()
  expect(() => Array.from({ length: 51 }).reduce<typeof scene>((value, _, index) => addRegion(value, { ...region, id: `m${index}` }), emptyHistory().present)).toThrow('50')
})

it('사각형 영역은 회전한 네 모서리로 경계를 잡고, 모양 변경·전체 지우기·같은 층 선택을 지킨다', () => {
  const rect: BlurRegion = { ...region, shape: 'rect' }
  expect(regionBounds(rect, 200, 100)).toEqual({ x: 30, y: 30, width: 40, height: 20 })
  // 45°: a rectangle's corners reach further than the inscribed ellipse.
  const rotated = regionBounds({ ...rect, rotation: 45 }, 200, 100)!, ellipse = regionBounds({ ...region, rotation: 45 }, 200, 100)!
  expect(rotated.width).toBe(Math.ceil(50 + 30 * Math.SQRT1_2) - Math.floor(50 - 30 * Math.SQRT1_2))
  expect(rotated.width).toBeGreaterThan(ellipse.width)
  let scene = addRegion(emptyHistory().present, region)
  expect(() => addRegion(scene, { ...region, id: 'bad', shape: 'star' as never })).toThrow()
  scene = updateSelectedRegion(scene, { style: 'blur', strength: 50, shape: 'rect' })
  expect(scene.regions[0].shape).toBe('rect')
  scene = updateSelectedRegion(scene, { style: 'mosaic', strength: 50 })
  expect(scene.regions[0]).toMatchObject({ shape: 'rect', style: 'mosaic' })
  scene = addInstance(scene, { id: 's', assetId: 'a', x: 1, y: 1, width: 10, height: 10, rotation: 0, zOrder: 0 })
  scene = { ...scene, selectedId: 'r' }
  // Deleting the last region never jumps the selection onto a sticker (different tool).
  expect(removeSelected(scene).selectedId).toBeNull()
  const cleared = clearRegions(scene)
  expect(cleared.regions).toEqual([]); expect(cleared.selectedId).toBeNull(); expect(cleared.stickers).toHaveLength(1)
  expect(clearRegions({ ...scene, selectedId: 's' }).selectedId).toBe('s')
})
