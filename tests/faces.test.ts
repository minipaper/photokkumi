import { describe, it, expect } from 'vitest'
import { DETECT_SIDE, MAX_FACES, STRIDES, decodeYunet, detectionSize, faceRegion, nms, type FaceBox } from '../src/shared/faces'

/** Empty YuNet outputs for a padded input, with helpers to plant one detection. */
function outputs(padWidth: number, padHeight: number) {
  const out: Record<string, Float32Array> = {}
  for (const stride of STRIDES) {
    const n = (padWidth / stride) * (padHeight / stride)
    out[`cls_${stride}`] = new Float32Array(n); out[`obj_${stride}`] = new Float32Array(n)
    out[`bbox_${stride}`] = new Float32Array(n * 4); out[`kps_${stride}`] = new Float32Array(n * 10)
  }
  const plant = (stride: number, row: number, col: number, score: number, box: [number, number, number, number]) => {
    const i = row * (padWidth / stride) + col
    out[`cls_${stride}`][i] = score; out[`obj_${stride}`][i] = score
    out[`bbox_${stride}`].set(box, i * 4)
  }
  return { out, plant }
}

describe('얼굴 인식 입력 크기', () => {
  it(`긴 변을 ${DETECT_SIDE}px 이하로 줄이고 32의 배수로 채운다 (작은 사진은 키우지 않음)`, () => {
    expect(detectionSize({ width: 4000, height: 3000 })).toEqual({ scale: 0.4, width: 1600, height: 1200, padWidth: 1600, padHeight: 1216 })
    expect(detectionSize({ width: 3000, height: 4000 })).toMatchObject({ width: 1200, height: 1600, padWidth: 1216, padHeight: 1600 })
    expect(detectionSize({ width: 548, height: 342 })).toEqual({ scale: 1, width: 548, height: 342, padWidth: 576, padHeight: 352 })
  })
})

describe('YuNet 결과 해석', () => {
  it('OpenCV와 같이 점수 √(cls·obj), 중심 (열+dx)·stride, 크기 e^(log)·stride로 상자를 만든다', () => {
    const { out, plant } = outputs(64, 64)
    // Stride 16, row 1, col 2: center ((2 + 0.5)·16, (1 + 0.25)·16) = (40, 20), size e^1·16 × e^0.5·16.
    plant(16, 1, 2, 0.81, [0.5, 0.25, 1, 0.5])
    const [face] = decodeYunet(out, 64, 64)
    expect(face.score).toBeCloseTo(0.81, 5)
    const width = Math.E * 16, height = Math.exp(0.5) * 16
    expect(face.width).toBeCloseTo(width, 5); expect(face.height).toBeCloseTo(height, 5)
    expect(face.x).toBeCloseTo(40 - width / 2, 5); expect(face.y).toBeCloseTo(20 - height / 2, 5)
  })
  it('기준 점수 아래는 버리고, 점수는 0~1로 자르며, 겹친 상자는 가장 높은 것 하나만 남긴다', () => {
    const { out, plant } = outputs(64, 64)
    plant(8, 3, 3, 0.5, [0, 0, 1, 1])
    plant(8, 4, 4, 0.95, [0, 0, 1, 1])
    plant(8, 4, 5, 0.9, [0, 0, 1, 1])
    plant(32, 0, 0, 1.7, [0, 0, 0, 0])
    const faces = decodeYunet(out, 64, 64)
    expect(faces.map(face => Math.round(face.score * 100))).toEqual([100, 95])
    expect(decodeYunet(out, 64, 64, 0.4)).toHaveLength(3)
  })
  it('출력 크기가 입력과 맞지 않으면 오류', () => {
    const { out } = outputs(64, 64)
    expect(() => decodeYunet(out, 96, 64)).toThrow('형식')
    expect(() => decodeYunet({}, 64, 64)).toThrow('형식')
  })
  it(`NMS는 점수 순으로 겹침 30% 이하만 남기고 최대 ${MAX_FACES}개`, () => {
    const box = (x: number, score: number): FaceBox => ({ x, y: 0, width: 10, height: 10, score })
    expect(nms([box(0, 0.7), box(2, 0.9), box(30, 0.8)]).map(face => face.score)).toEqual([0.9, 0.8])
    expect(nms(Array.from({ length: 80 }, (_, i) => box(i * 20, 0.7)))).toHaveLength(MAX_FACES)
  })
})

describe('얼굴 → 가림 영역', () => {
  it('인식 배율을 되돌려 원본 좌표로, 얼굴보다 조금 큰 타원(가로 1.3배·세로 1.4배)으로 만든다', () => {
    expect(faceRegion({ x: 100, y: 40, width: 40, height: 50, score: 0.9 }, 0.5, { width: 1000, height: 800 }))
      .toEqual({ x: 240, y: 130, width: 104, height: 140 })
    // Too small after scaling, or centered outside the photo (padding area).
    expect(faceRegion({ x: 0, y: 0, width: 1, height: 1, score: 0.9 }, 1, { width: 100, height: 100 })).toBeNull()
    expect(faceRegion({ x: 120, y: 10, width: 20, height: 20, score: 0.9 }, 1, { width: 100, height: 100 })).toBeNull()
  })
})
