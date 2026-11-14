import { describe, it, expect } from 'vitest'
import { CROP_PRESETS, aspectRatio, centeredCrop, cropArea, fullCrop, moveCrop, normalizeCrop, orient, resizeCrop, roundCrop, sameCrop, validCrop, validCropRect } from '../src/shared/crop'
import { validSaveRequest } from '../src/main/security'
import { DEFAULT_OUTPUT } from '../src/shared/output'

const photo = { width: 1200, height: 800 }
describe('자르기 비율·가운데 범위', () => {
  it('프리셋은 자유·원본·1:1·4:3·3:2·16:9·5:4이고 가로/세로를 바꾼다', () => {
    expect(CROP_PRESETS).toEqual(['free', 'original', '1:1', '4:3', '3:2', '16:9', '5:4'])
    expect(orient('4:3', true)).toBe('3:4'); expect(orient('3:4', false)).toBe('4:3'); expect(orient('16:9', true)).toBe('9:16'); expect(orient('5:4', true)).toBe('4:5')
    expect(orient('1:1', true)).toBe('1:1'); expect(orient('free', true)).toBe('free'); expect(orient('original', true)).toBe('original')
    expect(aspectRatio('free', photo)).toBeNull(); expect(aspectRatio('original', photo)).toBe(1.5); expect(aspectRatio('9:16', photo)).toBe(9 / 16)
  })
  it('비율을 고르면 그 비율로 가장 크게 가운데를 잡는다', () => {
    expect(centeredCrop(photo, '1:1')).toEqual({ x: 200, y: 0, width: 800, height: 800, aspect: '1:1' })
    expect(centeredCrop(photo, '4:3')).toEqual({ x: 66, y: 0, width: 1067, height: 800, aspect: '4:3' })
    expect(centeredCrop(photo, '16:9')).toEqual({ x: 0, y: 62, width: 1200, height: 675, aspect: '16:9' })
    expect(centeredCrop(photo, '9:16')).toEqual({ x: 375, y: 0, width: 450, height: 800, aspect: '9:16' })
    expect(centeredCrop(photo, 'original')).toMatchObject({ x: 0, y: 0, width: 1200, height: 800 })
    expect(centeredCrop({ width: 3, height: 1000 }, '16:9')).toMatchObject({ width: 3, height: 2 })
  })
  it('전체를 덮는 범위는 자르지 않음으로 정리하고, 같은 범위를 비교한다', () => {
    expect(normalizeCrop(fullCrop(photo), photo)).toBeUndefined()
    const crop = centeredCrop(photo, '1:1')
    expect(normalizeCrop(crop, photo)).toBe(crop)
    expect(sameCrop(crop, { ...crop })).toBe(true); expect(sameCrop(crop, { ...crop, aspect: 'free' })).toBe(false); expect(sameCrop(undefined, undefined)).toBe(true)
    expect(cropArea(undefined, photo)).toEqual({ x: 0, y: 0, width: 1200, height: 800 })
    expect(cropArea(crop, photo)).toEqual({ x: 200, y: 0, width: 800, height: 800 })
  })
  it('사진 밖이나 소수·잘못된 비율을 거부한다', () => {
    expect(validCrop({ x: 0, y: 0, width: 1200, height: 800, aspect: 'free' }, photo)).toBe(true)
    for (const bad of [null, {}, { x: -1, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: 1201, height: 10 }, { x: 1, y: 0, width: 1200, height: 10 }, { x: 0.5, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: 0, height: 10 }]) {
      expect(validCropRect(bad, photo)).toBe(false)
    }
    expect(validCrop({ x: 0, y: 0, width: 10, height: 10, aspect: '7:5' }, photo)).toBe(false)
  })
})
describe('자르기 상자 이동·크기 조절', () => {
  const box = { x: 200, y: 100, width: 400, height: 300 }
  it('이동은 크기를 지키며 사진 안에 머문다', () => {
    expect(moveCrop(box, -50, 900, photo)).toEqual({ x: 0, y: 500, width: 400, height: 300 })
    expect(moveCrop(box, 250, 120, photo)).toEqual({ x: 250, y: 120, width: 400, height: 300 })
  })
  it('자유 비율: 반대쪽 모서리를 고정하고 사진 끝과 최소 크기에서 멈춘다', () => {
    expect(resizeCrop(box, { x: 100, y: 50, width: 500, height: 350 }, 'top-left', null, photo)).toEqual({ x: 100, y: 50, width: 500, height: 350 })
    // Dragged past the photo's top-left corner: stops at 0, the bottom-right stays put.
    expect(resizeCrop(box, { x: -100, y: -100, width: 700, height: 500 }, 'top-left', null, photo)).toEqual({ x: 0, y: 0, width: 600, height: 400 })
    expect(resizeCrop(box, { x: 200, y: 100, width: 2000, height: 300 }, 'middle-right', null, photo)).toEqual({ x: 200, y: 100, width: 1000, height: 300 })
    expect(resizeCrop(box, { x: 200, y: 100, width: 400, height: 2 }, 'bottom-center', null, photo)).toEqual({ x: 200, y: 100, width: 400, height: 16 })
  })
  it('고정 비율: 모서리만 움직이고 비율을 지키며 사진을 넘지 않는다', () => {
    const square = { x: 200, y: 100, width: 300, height: 300 }
    expect(resizeCrop(square, { x: 200, y: 100, width: 400, height: 310 }, 'bottom-right', 1, photo)).toEqual({ x: 200, y: 100, width: 400, height: 400 })
    // Wanted 900 but only 700 fits below y=100.
    expect(resizeCrop(square, { x: 200, y: 100, width: 900, height: 900 }, 'bottom-right', 1, photo)).toEqual({ x: 200, y: 100, width: 700, height: 700 })
    expect(resizeCrop(square, { x: 100, y: 100, width: 400, height: 300 }, 'top-left', 1, photo)).toEqual({ x: 100, y: 0, width: 400, height: 400 })
    expect(resizeCrop(square, { x: 200, y: 100, width: 500, height: 300 }, 'middle-right', 1, photo)).toBe(square)
    const wide = resizeCrop({ x: 0, y: 0, width: 160, height: 90 }, { x: 0, y: 0, width: 320, height: 90 }, 'bottom-right', 16 / 9, photo)
    expect(wide.width / wide.height).toBeCloseTo(16 / 9)
  })
  it('정수 픽셀로 맞출 때 비율은 너비에서 높이를 계산한다', () => {
    expect(roundCrop({ x: 10.4, y: 20.6, width: 400.4, height: 299.7 }, 4 / 3, photo)).toEqual({ x: 10, y: 21, width: 400, height: 300 })
    expect(roundCrop({ x: 1199, y: 799, width: 100.2, height: 50.6 }, null, photo)).toEqual({ x: 1100, y: 749, width: 100, height: 51 })
  })
})
describe('저장 요청의 자르기 범위', () => {
  const good = { photoId: '00000000-0000-0000-0000-000000000000', png: new Uint8Array([1]), output: DEFAULT_OUTPUT }
  it('정수 4개만 받고 다른 필드는 거부한다', () => {
    expect(validSaveRequest({ ...good, crop: { x: 0, y: 0, width: 10, height: 10 } })).toBe(true)
    for (const crop of [null, { x: 0, y: 0, width: 10 }, { x: 0, y: 0, width: 10, height: 1.5 }, { x: 0, y: 0, width: 10, height: 10, aspect: '1:1' }, [0, 0, 10, 10]]) {
      expect(validSaveRequest({ ...good, crop })).toBe(false)
    }
    expect(validSaveRequest({ ...good, path: 'x' })).toBe(false)
  })
})
