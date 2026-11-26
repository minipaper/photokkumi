import { describe, it, expect } from 'vitest'
import { turnScene, turnedSize, validTurn } from '../src/shared/turn'
import { emptyHistory, type Scene } from '../src/shared/scene'
import type { StickerInstance } from '../src/shared/model'
import { validSaveRequest } from '../src/main/security'
import { DEFAULT_OUTPUT } from '../src/shared/output'

const frame = { width: 1200, height: 800 }
const sticker: StickerInstance = { id: 's', assetId: 'a', x: 100, y: 200, width: 80, height: 40, rotation: 10, zOrder: 1 }
const base = (): Scene => ({ ...emptyHistory().present, stickers: [sticker], crop: { x: 100, y: 50, width: 400, height: 300, aspect: '4:3' } })

describe('사진 90° 회전', () => {
  it('90°·270°에서 가로·세로가 바뀌고 회전값을 검증한다', () => {
    expect(turnedSize(frame, undefined)).toEqual(frame)
    expect(turnedSize(frame, 1)).toEqual({ width: 800, height: 1200 })
    expect(turnedSize(frame, 2)).toEqual(frame)
    expect(turnedSize(frame, 3)).toEqual({ width: 800, height: 1200 })
    expect([undefined, 1, 2, 3].every(validTurn)).toBe(true)
    expect([0, 4, -1, 1.5, '1', null].some(validTurn)).toBe(false)
  })
  it('오른쪽으로 돌리면 스티커 중심·각도와 자를 범위·비율이 사진과 함께 돈다', () => {
    const turned = turnScene(base(), frame, true)
    expect(turned.turn).toBe(1)
    // (x, y) → (H - y, x) in an 800-wide frame.
    expect(turned.stickers[0]).toEqual({ ...sticker, x: 600, y: 100, rotation: 100 })
    expect(turned.crop).toEqual({ x: 450, y: 100, width: 300, height: 400, aspect: '3:4' })
  })
  it('왼쪽으로 돌리면 반대로 돌고, 오른쪽→왼쪽이면 원래대로 돌아온다', () => {
    const left = turnScene(base(), frame, false)
    expect(left.turn).toBe(3)
    // (x, y) → (y, W - x).
    expect(left.stickers[0]).toEqual({ ...sticker, x: 200, y: 1100, rotation: -80 })
    expect(left.crop).toEqual({ x: 50, y: 700, width: 300, height: 400, aspect: '3:4' })
    const back = turnScene(turnScene(base(), frame, true), turnedSize(frame, 1), false)
    expect(back).toEqual(base())
    expect('turn' in back).toBe(false)
  })
  it('네 번 돌리면 제자리이고 각도는 -180~180으로 유지된다', () => {
    let scene = base(), size = frame
    for (let i = 0; i < 4; i++) { scene = turnScene(scene, size, true); size = turnedSize(size, 1) }
    expect(scene.turn).toBeUndefined()
    expect(scene.stickers[0]).toEqual(sticker)
    expect(scene.crop).toEqual(base().crop)
    let spun = { ...base(), stickers: [{ ...sticker, rotation: 170 }] }
    spun = turnScene(spun, frame, true)
    expect(spun.stickers[0].rotation).toBe(-100)
  })
  it('자르기 없음·1:1·원본 비율은 그대로 두고 블러·글자도 함께 돈다', () => {
    const scene: Scene = { ...emptyHistory().present, regions: [{ id: 'r', x: 10, y: 20, width: 30, height: 40, rotation: 0, style: 'blur', strength: 50 }] }
    const turned = turnScene(scene, frame, true)
    expect(turned.crop).toBeUndefined()
    expect(turned.regions[0]).toMatchObject({ x: 780, y: 10, width: 30, height: 40, rotation: 90 })
    expect(turnScene({ ...scene, crop: { x: 0, y: 0, width: 800, height: 800, aspect: '1:1' } }, frame, true).crop?.aspect).toBe('1:1')
    expect(turnScene({ ...scene, crop: { x: 0, y: 0, width: 600, height: 400, aspect: 'original' } }, frame, true).crop?.aspect).toBe('original')
  })
})

describe('저장 요청의 회전값', () => {
  const good = { photoId: '00000000-0000-0000-0000-000000000000', png: new Uint8Array([1]), output: DEFAULT_OUTPUT }
  it('1~3 정수만 받고 자르기와 함께 보낼 수 있다', () => {
    for (const turn of [1, 2, 3]) expect(validSaveRequest({ ...good, turn })).toBe(true)
    expect(validSaveRequest({ ...good, turn: 1, crop: { x: 0, y: 0, width: 10, height: 10 } })).toBe(true)
    for (const turn of [0, 4, -1, 1.5, '1', null, undefined]) expect(validSaveRequest({ ...good, turn })).toBe(false)
    expect(validSaveRequest({ ...good, turn: 1, path: 'x' })).toBe(false)
    expect(validSaveRequest({ ...good, turn: 1, crop: { x: 0, y: 0, width: 10, height: 10 }, extra: 1 })).toBe(false)
    expect(validSaveRequest({ photoId: good.photoId, png: good.png, turn: 1, crop: { x: 0, y: 0, width: 10, height: 10 } })).toBe(false)
  })
})
