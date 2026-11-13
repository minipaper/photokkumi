import { describe, it, expect } from 'vitest'
import { THUMB_TEMPLATES, arrangeTexts, attachShapes, carryContents, templateBase, templateById, templateColors, templateTexts } from '../src/shared/thumb-templates'
import { DEFAULT_BACKGROUND, PALETTES, palette, validBackground, validShapeItem, validThumbSaveRequest, type ShapeItem } from '../src/shared/shapes'
import { addShape, addText, applyLayout, applyTheme, emptyHistory, removeSelected, reorderSelected, setBackground, updateSelected, updateSelectedShape, updateSelectedText } from '../src/shared/scene'
import { DEFAULT_TEXT_STYLE, validTextItem, type TextItem } from '../src/shared/text'
import { bundledFont } from '../src/shared/fonts'
import { validMyTemplates } from '../src/renderer/ThumbPanel'

let counter = 0
const id = () => `id${++counter}`
const keep = { photoId: null, zoom: 100, focusX: 50, focusY: 50 }
const shape = (extra: Partial<ShapeItem> = {}): ShapeItem => ({ id: 's1', kind: 'rect', x: 100, y: 100, width: 200, height: 100, rotation: 0, fill: '#ff0000', fillOpacity: 100, stroke: '#000000', strokeWidth: 0, radius: 0, shadow: false, ...extra })
const text = (extra: Partial<TextItem> = {}): TextItem => ({ id: 't1', text: '안녕', fontSize: 100, style: { ...DEFAULT_TEXT_STYLE }, x: 500, y: 400, width: 200, height: 130, rotation: 0, ...extra })

describe('썸네일 템플릿 목록', () => {
  it('34개, ID가 겹치지 않고 사진형 약 70%·카드뉴스 약 30%이며 모든 값이 유효하다', () => {
    expect(THUMB_TEMPLATES).toHaveLength(34)
    expect(new Set(THUMB_TEMPLATES.map(item => item.id)).size).toBe(34)
    const photo = THUMB_TEMPLATES.filter(item => item.kind === 'photo').length
    expect(photo / THUMB_TEMPLATES.length).toBeGreaterThanOrEqual(0.65)
    expect(photo / THUMB_TEMPLATES.length).toBeLessThanOrEqual(0.75)
    for (const template of THUMB_TEMPLATES) {
      expect(palette(template.palette)).toBeTruthy()
      for (const colors of [templateColors(template, undefined), ...PALETTES]) {
        const base = templateBase(template, colors, keep, id)
        expect(validBackground(base.background)).toBe(true)
        expect(base.shapes.every(validShapeItem)).toBe(true)
        for (const { item } of templateTexts(template, colors, {}, id)) {
          expect(bundledFont(item.style.font)).toBeTruthy()
          expect(validTextItem({ ...item, x: 0, y: 0, width: 10, height: 10 })).toBe(true)
        }
      }
      // Slots are unique inside a template so a swap can carry each text.
      expect(new Set(template.texts.map(item => item.slot)).size).toBe(template.texts.length)
      expect(template.texts.some(item => item.slot === 'title')).toBe(true)
    }
  })
  it('카드뉴스는 사진을 숨기되 선택은 유지하고, 테마 색을 쓰는 값은 테마에 연결된다', () => {
    const card = templateById('c-spring')!, photo = templateById('p-color-box')!
    const cardBase = templateBase(card, palette('blue')!, { ...keep, photoId: 'x'.repeat(36) }, id)
    expect(cardBase.background).toMatchObject({ photoId: 'x'.repeat(36), hidePhoto: true, color: '#3d5afe', colorSlot: 'accent', dim: 0 })
    const photoBase = templateBase(photo, palette('green')!, keep, id)
    expect(photoBase.background.hidePhoto).toBeUndefined()
    expect(photoBase.shapes[0]).toMatchObject({ fill: '#1fae74', themed: { fill: 'accent' }, x: 540, y: 540, width: 740 })
    const texts = templateTexts(photo, palette('green')!, { title: '내 제목' }, id)
    expect(texts.find(spec => spec.item.slot === 'title')!.item).toMatchObject({ text: '내 제목', style: { color: '#ffffff' }, themed: { color: 'onAccent' } })
  })
})

describe('템플릿 글자 배치', () => {
  const anchor = (slot: string, top: number | { gap: number }, more: object = {}) => ({ slot, x: 100, top, align: 'left' as const, max: 900, ...more })
  it('글자는 위에서부터 간격을 두고 쌓이고, v=center/bottom이면 기준선에 가운데·아래를 맞춘다', () => {
    const boxes = [{ anchor: anchor('kicker', 300), width: 200, height: 50 }, { anchor: anchor('title', { gap: 10 }), width: 400, height: 200 }]
    expect(arrangeTexts(boxes)).toEqual([{ x: 200, y: 325 }, { x: 300, y: 460 }])
    const centered = arrangeTexts(boxes.map((box, index) => index ? box : { ...box, anchor: anchor('kicker', 540, { v: 'center' }) }))
    // Column 50 + 10 + 200 = 260 tall, centered on 540 → top 410.
    expect(centered[0].y).toBe(435); expect(centered[1].y).toBe(570)
    const bottom = arrangeTexts(boxes.map((box, index) => index ? box : { ...box, anchor: anchor('kicker', 1000, { v: 'bottom' }) }))
    expect(bottom[1].y + 100).toBe(1000)
  })
  it('after 글자는 같은 줄 오른쪽에 붙고, 가운데·오른쪽 정렬은 x를 기준으로 놓인다', () => {
    const placed = arrangeTexts([
      { anchor: anchor('tag', 500), width: 120, height: 40 },
      { anchor: { ...anchor('tag2', 0, { after: 'tag' }), x: 14 }, width: 100, height: 40 },
      { anchor: { ...anchor('sub', 800), align: 'center' as const, x: 540 }, width: 300, height: 40 },
      { anchor: { ...anchor('handle', 900), align: 'right' as const, x: 1000 }, width: 100, height: 40 }])
    expect(placed).toEqual([{ x: 160, y: 520 }, { x: 284, y: 520 }, { x: 540, y: 820 }, { x: 950, y: 920 }])
  })
  it('도형은 글자 둘레·위·아래에 붙는다', () => {
    const template = { ...templateById('c-ring')!, shapes: [
      { x: 0, y: 0, w: 10, h: 10, attach: { slots: ['title'], edge: 'around' as const, pad: [20, 10] as [number, number] } },
      { x: 0, y: 0, w: 10, h: 4, attach: { slots: ['title'], edge: 'top' as const, gap: 6 } },
      { x: 50, y: 0, w: 10, h: 4, attach: { slots: ['title'], edge: 'bottom' as const, gap: 6 } },
      { x: 50, y: 70, w: 10, h: 4 }] }
    const base = templateBase(template, palette('red')!, keep, id).shapes
    const moved = attachShapes(template, base, new Map([['title', { x: 500, y: 400, width: 300, height: 100 }]]))
    expect(moved[0]).toMatchObject({ x: 500, y: 400, width: 340, height: 120 })
    expect(moved[1].y).toBe(350 - 6 - 2)
    expect(moved[2]).toMatchObject({ x: 55, y: 450 + 6 + 2 })
    expect(moved[3]).toEqual(base[3])
  })
  it('템플릿을 바꿀 때 같은 자리 글자를 옮기고, 제목 두 줄과 제목+강조 줄을 서로 나누고 합친다', () => {
    const split = templateById('c-spring')!, single = templateById('p-newpost')!
    expect(carryContents([{ slot: 'title', text: '제주\n여행 기록' }, { slot: 'sub', text: '부제' }, { slot: 'tag2', text: '#x' }], split))
      .toEqual({ title: '제주', title2: '여행 기록', sub: '부제' })
    expect(carryContents([{ slot: 'title', text: '제주' }, { slot: 'title2', text: '여행' }], single)).toEqual({ title: '제주\n여행' })
    expect(carryContents([{ text: '슬롯 없는 글자' }], single)).toEqual({})
  })
})

describe('썸네일 장면', () => {
  it('도형 추가·이동·스타일 변경·순서·삭제, 직접 바꾼 색은 테마 연결을 끊는다', () => {
    let scene = addShape(emptyHistory().present, shape({ themed: { fill: 'accent', stroke: 'soft' } }))
    scene = addShape(scene, shape({ id: 's2' }))
    expect(() => addShape(scene, shape({ id: 's2' }))).toThrow()
    expect(() => addShape(scene, shape({ id: 's3', fill: 'red' }))).toThrow()
    scene = updateSelected({ ...scene, selectedId: 's1' }, { x: 10, y: 20, width: 30, height: 40, rotation: 5 })
    expect(scene.shapes[0]).toMatchObject({ x: 10, y: 20, width: 30, height: 40, rotation: 5 })
    scene = updateSelectedShape(scene, { kind: 'rect', fill: '#00ff00', fillOpacity: 50, stroke: '#000000', strokeWidth: 4, radius: 50, shadow: true })
    expect(scene.shapes[0]).toMatchObject({ fill: '#00ff00', fillOpacity: 50, radius: 50, themed: { stroke: 'soft' } })
    expect(scene.shapes[0].themed?.fill).toBeUndefined()
    scene = reorderSelected(scene, 1)
    expect(scene.shapes.map(item => item.id)).toEqual(['s2', 's1'])
    scene = removeSelected(scene)
    expect(scene).toMatchObject({ shapes: [{ id: 's2' }], selectedId: 's2' })
  })
  it('색 테마는 테마에 연결된 색만 바꾸고 배경색 연결은 같은 색일 때만 유지한다', () => {
    let scene = addShape(emptyHistory().present, shape({ themed: { fill: 'accent' }, stroke: '#123456' }))
    scene = addText(scene, text({ themed: { boxColor: 'soft' } }))
    scene = setBackground(scene, { ...DEFAULT_BACKGROUND, colorSlot: 'accent' })
    scene = { ...scene, background: { ...scene.background!, colorSlot: 'accent' } }
    const green = palette('green')!
    const themed = applyTheme(scene, green)
    expect(themed).toMatchObject({ theme: 'green', background: { color: green.accent }, shapes: [{ fill: green.accent, stroke: '#123456' }], texts: [{ style: { boxColor: green.soft, color: '#ffffff' } }] })
    expect(setBackground(themed, { ...themed.background!, dim: 10 }).background?.colorSlot).toBe('accent')
    expect(setBackground(themed, { ...themed.background!, color: '#000000' }).background?.colorSlot).toBeUndefined()
  })
  it('왼쪽 정렬 글자는 내용이 길어져도 왼쪽 끝이 그대로이고, 바꾼 글자색은 테마 연결이 끊긴다', () => {
    const scene = addText(emptyHistory().present, text({ style: { ...DEFAULT_TEXT_STYLE, align: 'left' }, themed: { color: 'accent', boxColor: 'soft' } }))
    const longer = updateSelectedText(scene, { text: '안녕하세요', fontSize: 100, style: { ...scene.texts[0].style, color: '#000000' }, width: 400, height: 130 })
    expect(longer.texts[0].x - longer.texts[0].width / 2).toBe(400)
    expect(longer.texts[0].themed).toEqual({ boxColor: 'soft' })
  })
  it('레이아웃 적용은 스티커를 두고 템플릿 부분만 바꾸며 잘못된 값은 거부한다', () => {
    const scene = { ...emptyHistory().present, stickers: [{ id: 'k', assetId: 'a', x: 1, y: 1, width: 1, height: 1, rotation: 0, zOrder: 0 }] }
    const applied = applyLayout(scene, { background: { ...DEFAULT_BACKGROUND }, shapes: [shape()], texts: [text()], template: 'p-newpost' })
    expect(applied).toMatchObject({ stickers: [{ id: 'k' }], shapes: [{ id: 's1' }], texts: [{ id: 't1' }], template: 'p-newpost', selectedId: null })
    expect(() => applyLayout(scene, { background: { ...DEFAULT_BACKGROUND, dim: 95 }, shapes: [], texts: [] })).toThrow()
    expect(() => applyLayout(scene, { background: { ...DEFAULT_BACKGROUND }, shapes: [shape({ id: 'k' })], texts: [] })).toThrow()
  })
})

describe('썸네일 값 검증', () => {
  it('배경·도형·저장 요청·내 템플릿을 검사한다', () => {
    expect(validBackground({ ...DEFAULT_BACKGROUND, hidePhoto: true })).toBe(true)
    for (const bad of [{ zoom: 99 }, { focusX: 101 }, { dim: 91 }, { color: '#fff' }, { photoId: 'short' }, { hidePhoto: false }, { colorSlot: 'pink' }]) {
      expect(validBackground({ ...DEFAULT_BACKGROUND, ...bad })).toBe(false)
    }
    for (const bad of [{ kind: 'star' }, { fillOpacity: 101 }, { strokeWidth: 201 }, { radius: 51 }, { themed: { fill: 'neon' } }, { themed: { color: 'accent' } }, { width: 0 }]) {
      expect(validShapeItem(shape(bad as Partial<ShapeItem>))).toBe(false)
    }
    const png = new Uint8Array([1])
    expect(validThumbSaveRequest({ photoId: null, png, format: 'jpg' })).toBe(true)
    for (const bad of [{ photoId: 'x', png, format: 'jpg' }, { photoId: null, png: [1], format: 'jpg' }, { photoId: null, png, format: 'gif' }, { photoId: null, png, format: 'png', extra: 1 }]) expect(validThumbSaveRequest(bad)).toBe(false)
    const mine = { id: 'm', name: '내 템플릿 1', preview: 'data:image/jpeg;base64,AA==', layout: { background: { ...DEFAULT_BACKGROUND }, shapes: [shape()], texts: [text()] } }
    expect(validMyTemplates([mine])).toBe(true)
    for (const bad of [{ ...mine, preview: 'data:image/png;base64,AA==' }, { ...mine, layout: { ...mine.layout, background: { ...DEFAULT_BACKGROUND, photoId: 'x'.repeat(36) } } },
      { ...mine, theme: 'neon' }, { ...mine, layout: { ...mine.layout, texts: [text({ fontSize: 1 })] } }]) expect(validMyTemplates([bad])).toBe(false)
  })
})
