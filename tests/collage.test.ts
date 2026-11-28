import { describe, it, expect } from 'vitest'
import {
  COLLAGE_LAYOUTS, COLLAGE_MAX_PIXELS, COLLAGE_MAX_SIDE, DEFAULT_COLLAGE, DEFAULT_VIEW, STACK_MAX, arrangeCells, cellCount, coverSource, panView,
  placePhoto, planCollage, removeCell, swapCells, validCollageOptions, validCollageSaveRequest, zoomView, type CollageCell, type CollageOptions, type Rect
} from '../src/shared/collage'

const options = (patch: Partial<CollageOptions> = {}): CollageOptions => ({ ...DEFAULT_COLLAGE, ...patch })
const ids = ['a', 'b', 'c', 'd', 'e', 'f'].map(letter => letter.repeat(36))
const cell = (photoId: string | null, zoom = 1): CollageCell => ({ photoId, view: { ...DEFAULT_VIEW, zoom } })
/** No two cells overlap and every cell lies inside the canvas. */
function disjoint(cells: Rect[], width: number, height: number) {
  for (const [index, a] of cells.entries()) {
    expect(a.x).toBeGreaterThanOrEqual(0); expect(a.y).toBeGreaterThanOrEqual(0)
    expect(a.x + a.width).toBeLessThanOrEqual(width); expect(a.y + a.height).toBeLessThanOrEqual(height)
    for (const b of cells.slice(index + 1)) expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true)
  }
}

describe('사진 합치기 레이아웃', () => {
  it('레이아웃 6종과 칸 수', () => {
    expect(COLLAGE_LAYOUTS.map(item => item.name)).toEqual(['2장 가로', '2장 세로', '3장 (큰 1 + 작은 2)', '3장 가로', '4장 2×2', '세로 이어붙이기'])
    expect(COLLAGE_LAYOUTS.map(item => cellCount(item.id))).toEqual([2, 2, 3, 3, 4, 2])
    expect(cellCount('stack', 7)).toBe(7); expect(cellCount('stack', 30)).toBe(STACK_MAX); expect(cellCount('stack', 0)).toBe(2)
  })
  it('2×2: 간격·바깥 여백이 정수 픽셀로 정확하다', () => {
    const plan = planCollage(options({ layout: 'grid-4', width: 1080, gap: 10, margin: true }))
    // inner 1060 → two 525 px cells with a 10 px gap; square cells.
    expect(plan).toMatchObject({ width: 1080, height: 1080, gap: 10, margin: 10, scale: 1 })
    expect(plan.cells).toEqual([
      { x: 10, y: 10, width: 525, height: 525 }, { x: 545, y: 10, width: 525, height: 525 },
      { x: 10, y: 545, width: 525, height: 525 }, { x: 545, y: 545, width: 525, height: 525 }
    ])
    const tight = planCollage(options({ layout: 'grid-4', gap: 0, margin: true }))
    expect(tight.cells[3]).toEqual({ x: 540, y: 540, width: 540, height: 540 })
    const noMargin = planCollage(options({ layout: 'grid-4', gap: 20, margin: false }))
    expect(noMargin.cells[0]).toEqual({ x: 0, y: 0, width: 530, height: 530 })
    expect(noMargin.cells[1].x).toBe(550)
    expect(noMargin.height).toBe(1080)
  })
  it('모든 격자 레이아웃·너비·간격에서 칸이 겹치지 않고 비율이 맞다', () => {
    for (const layout of COLLAGE_LAYOUTS.filter(item => item.rows)) for (const width of [1080, 1600, 2000] as const) for (const gap of [0, 7, 40]) for (const margin of [true, false]) {
      const plan = planCollage(options({ layout: layout.id, width, gap, margin }))
      expect(plan.width).toBe(width)
      expect(plan.cells).toHaveLength(cellCount(layout.id))
      disjoint(plan.cells, plan.width, plan.height)
      for (const item of plan.cells) expect(Number.isInteger(item.x) && Number.isInteger(item.y) && Number.isInteger(item.width) && Number.isInteger(item.height)).toBe(true)
      // Rows span the whole inner width.
      const right = Math.max(...plan.cells.map(item => item.x + item.width))
      expect(right).toBe(width - (margin ? gap : 0))
      expect(plan.height - Math.max(...plan.cells.map(item => item.y + item.height))).toBe(margin ? gap : 0)
    }
    const big = planCollage(options({ layout: 'trio-big', gap: 0, margin: false }))
    expect(big.cells.map(item => [item.width, item.height])).toEqual([[1080, 720], [540, 360], [540, 360]])
    const pair = planCollage(options({ layout: 'pair-h', gap: 0, margin: false }))
    expect(pair).toMatchObject({ width: 1080, height: 720 })
    expect(planCollage(options({ layout: 'pair-v', gap: 0, margin: false })).height).toBe(1620)
    expect(planCollage(options({ layout: 'trio-h', gap: 0, margin: false })).cells.map(item => item.width)).toEqual([360, 360, 360])
  })
  it('세로 이어붙이기: 사진마다 비율을 지키고 너비는 출력 너비다', () => {
    const plan = planCollage(options({ layout: 'stack', width: 1080, gap: 10, margin: false }), [{ width: 1200, height: 800 }, { width: 600, height: 900 }, { width: 1000, height: 1000 }])
    expect(plan.cells).toEqual([
      { x: 0, y: 0, width: 1080, height: 720 }, { x: 0, y: 730, width: 1080, height: 1620 }, { x: 0, y: 2360, width: 1080, height: 1080 }
    ])
    expect(plan.height).toBe(3440)
    const framed = planCollage(options({ layout: 'stack', width: 1600, gap: 20, margin: true }), [{ width: 400, height: 300 }, { width: 400, height: 300 }])
    expect(framed.cells).toEqual([{ x: 20, y: 20, width: 1560, height: 1170 }, { x: 20, y: 1210, width: 1560, height: 1170 }])
    expect(framed.height).toBe(2400)
    expect(() => planCollage(options({ layout: 'stack' }), [{ width: 10, height: 10 }])).toThrow('2~10장')
    expect(() => planCollage(options({ layout: 'stack' }), Array(11).fill({ width: 10, height: 10 }))).toThrow('2~10장')
    expect(() => planCollage(options({ layout: 'stack' }), [{ width: 10, height: 10 }, { width: 0, height: 10 }])).toThrow()
  })
  it('한도를 넘는 긴 이어붙이기는 너비·간격·모서리를 함께 줄여 1,600만 픽셀·8,192px 안에 맞춘다', () => {
    const tall = Array(10).fill({ width: 3000, height: 4000 })
    const plan = planCollage(options({ layout: 'stack', width: 2000, gap: 40, margin: true, radius: 40 }), tall)
    expect(plan.height).toBeLessThanOrEqual(COLLAGE_MAX_SIDE)
    expect(plan.width * plan.height).toBeLessThanOrEqual(COLLAGE_MAX_PIXELS)
    expect(plan.scale).toBeLessThan(1)
    expect(plan.width).toBeLessThan(2000)
    expect(plan.gap).toBe(Math.round(40 * plan.scale)); expect(plan.radius).toBe(Math.round(40 * plan.scale))
    // Still as large as the height limit allows (within a few pixels of rounding).
    expect(plan.height).toBeGreaterThan(COLLAGE_MAX_SIDE - 40)
    disjoint(plan.cells, plan.width, plan.height)
    // Pixel limit (not side limit) binds for a wide stack of two.
    const wide = planCollage(options({ layout: 'stack', width: 2000, gap: 0, margin: false }), [{ width: 1000, height: 2200 }, { width: 1000, height: 2200 }])
    expect(wide.width * wide.height).toBeLessThanOrEqual(COLLAGE_MAX_PIXELS)
    expect(wide.height).toBeLessThanOrEqual(COLLAGE_MAX_SIDE)
    // Hopelessly long panoramas are refused instead of shrinking to nothing.
    expect(() => planCollage(options({ layout: 'stack' }), Array(10).fill({ width: 100, height: 8000 }))).toThrow('사진 수를 줄이세요')
  })
})

describe('칸 채우기 (cover)·끌기·확대', () => {
  it('cover: 짧은 쪽이 칸에 꼭 맞고 가운데를 보여 준다', () => {
    expect(coverSource({ width: 1200, height: 800 }, { width: 500, height: 500 }, DEFAULT_VIEW)).toEqual({ x: 200, y: 0, width: 800, height: 800 })
    expect(coverSource({ width: 600, height: 900 }, { width: 300, height: 300 }, DEFAULT_VIEW)).toEqual({ x: 0, y: 150, width: 600, height: 600 })
    // Same aspect: the whole photo.
    expect(coverSource({ width: 1200, height: 800 }, { width: 600, height: 400 }, DEFAULT_VIEW)).toEqual({ x: 0, y: 0, width: 1200, height: 800 })
    expect(coverSource({ width: 1200, height: 800 }, { width: 500, height: 500 }, { zoom: 2, x: 0, y: 1 })).toEqual({ x: 0, y: 400, width: 400, height: 400 })
    // Zoom is clamped to 1–4 (never smaller than cover).
    expect(coverSource({ width: 1200, height: 800 }, { width: 500, height: 500 }, { zoom: 0.2, x: 0.5, y: 0.5 }).height).toBe(800)
  })
  it('끌기: 사진이 포인터를 따라가고 가장자리를 넘지 않는다', () => {
    const source = { width: 1200, height: 800 }, target = { width: 500, height: 500 }
    // Cover scale 0.625 → the photo is 750 px wide in a 500 px cell: 250 px to spare.
    const right = panView(DEFAULT_VIEW, source, target, 125, 40)
    expect(right).toEqual({ zoom: 1, x: 0, y: 0.5 })
    expect(panView(DEFAULT_VIEW, source, target, -62.5, 0).x).toBeCloseTo(0.75)
    expect(panView(DEFAULT_VIEW, source, target, -1000, 0).x).toBe(1)
    // Moving the photo left by 62.5 px shows the part 62.5/0.625 = 100 source px further right.
    const moved = coverSource(source, target, panView(DEFAULT_VIEW, source, target, -62.5, 0))
    expect(moved.x).toBeCloseTo(300)
    const zoomed = zoomView(DEFAULT_VIEW, 2)
    expect(panView(zoomed, source, target, 0, 125).y).toBeCloseTo(0.25)
    expect(zoomView(DEFAULT_VIEW, 9).zoom).toBe(4); expect(zoomView(DEFAULT_VIEW, 0).zoom).toBe(1)
  })
})

describe('칸 배정·바꾸기·빼기', () => {
  it('레이아웃을 바꾸면 놓인 사진은 자리를 지키고 빈 칸은 쓰지 않은 사진으로 채운다', () => {
    const grid = arrangeCells([], 'grid-4', ids.slice(0, 3))
    expect(grid.map(item => item.photoId)).toEqual([ids[0], ids[1], ids[2], null])
    const swapped = swapCells(arrangeCells([], 'grid-4', ids), 0, 3)
    expect(arrangeCells(swapped, 'pair-h', ids).map(item => item.photoId)).toEqual([ids[3], ids[1]])
    // Back to four: the cut cells are refilled with unused photos in list order.
    expect(arrangeCells(arrangeCells(swapped, 'pair-h', ids), 'grid-4', ids).map(item => item.photoId)).toEqual([ids[3], ids[1], ids[0], ids[2]])
    // A removed photo leaves its cell and another photo fills it.
    expect(arrangeCells([cell(ids[0]), cell(ids[1], 3)], 'pair-h', [ids[1], ids[2]]).map(item => [item.photoId, item.view.zoom])).toEqual([[ids[2], 1], [ids[1], 3]])
    // A new stack takes every photo (up to 10); a stack from a grid keeps the grid's photos.
    expect(arrangeCells([], 'stack', ids)).toHaveLength(6)
    expect(arrangeCells([], 'stack', Array.from({ length: 14 }, (_, i) => String(i).padStart(36, '0')))).toHaveLength(10)
    expect(arrangeCells(arrangeCells([], 'trio-h', ids), 'stack', ids).map(item => item.photoId)).toEqual(ids.slice(0, 3))
    expect(arrangeCells([], 'stack', [ids[0]]).map(item => item.photoId)).toEqual([ids[0], null])
  })
  it('사진 누르기: 고른 칸 → 첫 빈 칸 → (이어붙이기) 끝에 추가', () => {
    const cells = [cell(ids[0]), cell(null)]
    expect(placePhoto(cells, 'pair-h', 0, ids[2])).toEqual({ cells: [cell(ids[2]), cell(null)], index: 0 })
    expect(placePhoto(cells, 'pair-h', null, ids[2])!.index).toBe(1)
    expect(placePhoto([cell(ids[0]), cell(ids[1])], 'pair-h', null, ids[2])).toBeNull()
    const stack = placePhoto([cell(ids[0]), cell(ids[1])], 'stack', null, ids[2])!
    expect(stack.index).toBe(2); expect(stack.cells.map(item => item.photoId)).toEqual([ids[0], ids[1], ids[2]])
    const full = Array.from({ length: STACK_MAX }, () => cell(ids[0]))
    expect(placePhoto(full, 'stack', null, ids[1])).toBeNull()
    // A new photo starts centred at cover.
    expect(placePhoto([cell(ids[0], 3)], 'pair-h', 0, ids[1])!.cells[0].view).toEqual(DEFAULT_VIEW)
  })
  it('바꾸기는 사진과 위치·확대를 함께 옮기고, 빼기는 이어붙이기에서 칸을 없앤다', () => {
    const cells = [cell(ids[0], 2), cell(ids[1])]
    expect(swapCells(cells, 0, 1)).toEqual([cell(ids[1]), cell(ids[0], 2)])
    expect(swapCells(cells, 0, 5)).toEqual(cells)
    expect(removeCell(cells, 'pair-h', 0).map(item => item.photoId)).toEqual([null, ids[1]])
    expect(removeCell([...cells, cell(ids[2])], 'stack', 1).map(item => item.photoId)).toEqual([ids[0], ids[2]])
    expect(removeCell(cells, 'stack', 1).map(item => item.photoId)).toEqual([ids[0], null])
  })
})

describe('설정·저장 요청 검증', () => {
  it('설정 값의 범위와 형식', () => {
    expect(validCollageOptions(DEFAULT_COLLAGE)).toBe(true)
    expect(validCollageOptions({ ...DEFAULT_COLLAGE, gap: 41 })).toBe(false)
    expect(validCollageOptions({ ...DEFAULT_COLLAGE, radius: 1.5 })).toBe(false)
    expect(validCollageOptions({ ...DEFAULT_COLLAGE, width: 1200 })).toBe(false)
    expect(validCollageOptions({ ...DEFAULT_COLLAGE, background: 'red' })).toBe(false)
    expect(validCollageOptions({ ...DEFAULT_COLLAGE, layout: 'grid-9' })).toBe(false)
    expect(validCollageOptions({ ...DEFAULT_COLLAGE, extra: 1 })).toBe(false)
  })
  it('저장 요청 모양·크기 한도', () => {
    const request = { photoId: ids[0], png: new Uint8Array(4), format: 'jpg', width: 1080, height: 1080 }
    expect(validCollageSaveRequest(request)).toBe(true)
    expect(validCollageSaveRequest({ ...request, photoId: '../x' })).toBe(false)
    expect(validCollageSaveRequest({ ...request, png: [1, 2] })).toBe(false)
    expect(validCollageSaveRequest({ ...request, format: 'gif' })).toBe(false)
    expect(validCollageSaveRequest({ ...request, height: 8193 })).toBe(false)
    expect(validCollageSaveRequest({ ...request, width: 8000, height: 8000 })).toBe(false)
    expect(validCollageSaveRequest({ ...request, width: 10.5 })).toBe(false)
    expect(validCollageSaveRequest({ ...request, path: '/etc' })).toBe(false)
  })
})
