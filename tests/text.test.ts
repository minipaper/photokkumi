import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_TEXT_STYLE, MAX_MY_PRESETS, MAX_TEXTS, TEXT_PRESETS, layoutText, samePreset, validMyPresets, lineAnchor, scaleText, validTextItem, validTextStyle, type TextItem } from '../src/shared/text'
import { BUNDLED_FONTS, fontFamilyList, systemFont, validFontRef } from '../src/shared/fonts'
import { addInstance, addText, clearTexts, commitScene, duplicateSelected, emptyHistory, removeSelected, undoScene, updateSelected, updateSelectedText } from '../src/shared/scene'
import { allowedPermission, bundleFileType } from '../src/main/security'

const text = (id: string, extra: Partial<TextItem> = {}): TextItem => ({ id, text: '안녕', fontSize: 100, style: { ...DEFAULT_TEXT_STYLE }, x: 500, y: 400, width: 200, height: 146, rotation: 0, ...extra })
// Every character is 50 units wide at the given size; enough to check the box arithmetic.
const measure = (line: string) => line.length * 50

describe('글자 레이아웃', () => {
  it('여러 줄·외곽선·배경 상자를 글자 크기 기준으로 계산한다', () => {
    const plain = layoutText({ text: '가나\n다', fontSize: 100, style: { ...DEFAULT_TEXT_STYLE, strokeWidth: 0, boxOpacity: 0 } }, measure)
    expect(plain).toMatchObject({ lines: ['가나', '다'], lineHeight: 130, stroke: 0, padX: 0, padY: 0, width: 100, height: 260 })
    const outlined = layoutText({ text: '가나', fontSize: 100, style: { ...DEFAULT_TEXT_STYLE, strokeWidth: 10, boxOpacity: 0 } }, measure)
    expect(outlined).toMatchObject({ stroke: 10, width: 120, height: 150 })
    const boxed = layoutText({ text: '가나', fontSize: 100, style: { ...DEFAULT_TEXT_STYLE, strokeWidth: 0, boxOpacity: 50 } }, measure)
    expect(boxed).toMatchObject({ padX: 40, padY: 20, width: 180, height: 170 })
    // An empty text keeps a grabbable box.
    expect(layoutText({ text: '', fontSize: 100, style: DEFAULT_TEXT_STYLE }, measure).width).toBeGreaterThan(0)
  })
  it('정렬 기준선은 상자 안쪽 여백과 외곽선만큼 들어온다', () => {
    const layout = { padX: 40, stroke: 10 }
    expect(lineAnchor('left', 300, layout)).toBe(-100)
    expect(lineAnchor('center', 300, layout)).toBe(0)
    expect(lineAnchor('right', 300, layout)).toBe(100)
  })
  it('핸들 크기 조절은 글자 크기와 상자를 같은 비율로 바꾸고 한도에서 멈춘다', () => {
    const scaled = scaleText(text('t'), { x: 10, y: 20, width: 400, height: 999, rotation: 30 })
    expect(scaled).toMatchObject({ fontSize: 200, width: 400, height: 292, x: 10, y: 20, rotation: 30 })
    const tiny = scaleText(text('t'), { x: 0, y: 0, width: 1, height: 1, rotation: 0 })
    expect(tiny.fontSize).toBe(4)
    expect(tiny.width).toBeCloseTo(8)
  })
})

describe('글자 값 검증', () => {
  it('색·정렬·범위·글꼴 참조를 검사한다', () => {
    expect(validTextStyle(DEFAULT_TEXT_STYLE)).toBe(true)
    for (const preset of TEXT_PRESETS) expect(validTextStyle({ ...DEFAULT_TEXT_STYLE, ...preset.style })).toBe(true)
    for (const bad of [{ color: 'red' }, { color: '#fff' }, { align: 'justify' }, { strokeWidth: 31 }, { strokeWidth: 1.5 }, { boxOpacity: -1 }, { font: 'unknown' }, { bold: 'yes' }]) {
      expect(validTextStyle({ ...DEFAULT_TEXT_STYLE, ...bad })).toBe(false)
    }
    expect(validTextItem(text('t'))).toBe(true)
    expect(validTextItem(text('t', { fontSize: 2 }))).toBe(false)
    expect(validTextItem(text('t', { text: 'x'.repeat(501) }))).toBe(false)
  })
  it('PC 글꼴 이름은 CSS 글꼴 문자열을 깨뜨리는 문자를 거부한다', () => {
    expect(validFontRef('pretendard')).toBe(true)
    expect(validFontRef(systemFont('맑은 고딕'))).toBe(true)
    expect(validFontRef(systemFont('Malgun Gothic Semilight'))).toBe(true)
    for (const bad of ['a"b', 'a\\b', 'a;b', '', ' lead', 'x'.repeat(121), 'a\nb']) expect(validFontRef(systemFont(bad))).toBe(false)
    expect(fontFamilyList(systemFont('맑은 고딕'))).toBe('"맑은 고딕", "PK pretendard", sans-serif')
    expect(fontFamilyList('jua')).toBe('"PK jua", "PK pretendard", sans-serif')
  })
})

describe('빠른 스타일과 내 스타일', () => {
  it('빠른 스타일은 7개씩 3줄, 이름이 겹치지 않고 3번째 줄만 글꼴을 바꾼다', () => {
    expect(TEXT_PRESETS).toHaveLength(21)
    expect(new Set(TEXT_PRESETS.map(preset => preset.name)).size).toBe(21)
    expect(TEXT_PRESETS.map(preset => !!preset.style.font)).toEqual([...Array(14).fill(false), ...Array(7).fill(true)])
  })
  it('저장된 내 스타일 목록을 검증하고 같은 스타일을 알아본다', () => {
    const mine = { id: 'm1', style: { ...DEFAULT_TEXT_STYLE }, relSize: 0.1 }
    expect(validMyPresets([])).toBe(true)
    expect(validMyPresets([mine])).toBe(true)
    for (const bad of [[{ ...mine, relSize: 0 }], [{ ...mine, relSize: 2 }], [{ ...mine, style: { ...mine.style, color: 'red' } }], [{ ...mine, id: 5 }], 'x', null,
      Array.from({ length: MAX_MY_PRESETS + 1 }, (_, index) => ({ ...mine, id: String(index) }))]) expect(validMyPresets(bad)).toBe(false)
    expect(samePreset(mine, { style: { ...DEFAULT_TEXT_STYLE }, relSize: 0.1004 })).toBe(true)
    expect(samePreset(mine, { style: { ...DEFAULT_TEXT_STYLE }, relSize: 0.12 })).toBe(false)
    expect(samePreset(mine, { style: { ...DEFAULT_TEXT_STYLE, shadow: true }, relSize: 0.1 })).toBe(false)
  })
})

describe('글자 장면 편집', () => {
  it('추가·이동·크기·내용 변경·복제·삭제·모두 지우기와 undo가 사진 장면 안에서 동작한다', () => {
    let history = emptyHistory()
    history = commitScene(history, addText(history.present, text('a')))
    expect(history.present.selectedId).toBe('a')
    history = commitScene(history, updateSelected(history.present, { x: 600, y: 300, width: 300, height: 219, rotation: 15 }))
    expect(history.present.texts[0]).toMatchObject({ x: 600, y: 300, fontSize: 150, rotation: 15 })
    history = commitScene(history, updateSelectedText(history.present, { text: '두 줄\n글자', fontSize: 150, style: { ...DEFAULT_TEXT_STYLE, color: '#ff0000' }, width: 320, height: 400 }))
    expect(history.present.texts[0]).toMatchObject({ text: '두 줄\n글자', width: 320, style: { color: '#ff0000' } })
    expect(() => updateSelectedText(history.present, { text: 'x', fontSize: 150, style: { ...DEFAULT_TEXT_STYLE, color: 'bad' }, width: 1, height: 1 })).toThrow()
    history = commitScene(history, duplicateSelected(history.present, 'b'))
    expect(history.present.texts.map(item => [item.id, item.x])).toEqual([['a', 600], ['b', 620]])
    history = commitScene(history, removeSelected(history.present))
    expect(history.present.texts.map(item => item.id)).toEqual(['a'])
    expect(history.present.selectedId).toBe('a')
    history = commitScene(history, clearTexts(history.present))
    expect(history.present).toMatchObject({ texts: [], selectedId: null })
    history = undoScene(undoScene(history))
    expect(history.present.texts.map(item => item.id)).toEqual(['a', 'b'])
  })
  it('스티커와 ID가 겹치거나 한도를 넘거나 잘못된 값이면 추가하지 않는다', () => {
    const scene = addInstance(emptyHistory().present, { id: 's', assetId: 'x', x: 1, y: 1, width: 1, height: 1, rotation: 0, zOrder: 0 })
    expect(() => addText(scene, text('s'))).toThrow()
    expect(() => addText(scene, text('t', { width: 0 }))).toThrow()
    let full = emptyHistory().present
    for (let index = 0; index < MAX_TEXTS; index++) full = addText(full, text(`t${index}`))
    expect(() => addText(full, text('over'))).toThrow('최대 50개')
    // Moving a sticker leaves texts alone and vice versa.
    const both = addText(scene, text('t'))
    const moved = updateSelected({ ...both, selectedId: 's' }, { x: 9, y: 9, width: 1, height: 1, rotation: 0 })
    expect(moved.texts[0]).toEqual(both.texts[0])
  })
})

describe('내장 글꼴 배포 파일', () => {
  const root = join(__dirname, '..', 'src', 'renderer', 'public', 'fonts')
  it('목록의 모든 글꼴 파일과 OFL 원문이 함께 있고 목록에 없는 파일은 없다', () => {
    expect(BUNDLED_FONTS.length).toBeGreaterThanOrEqual(15)
    expect(new Set(BUNDLED_FONTS.map(font => font.id)).size).toBe(BUNDLED_FONTS.length)
    for (const font of BUNDLED_FONTS) {
      const license = readFileSync(join(root, font.id, 'OFL.txt'), 'utf8')
      expect(license).toMatch(/SIL Open Font License|SIL OPEN FONT LICENSE/)
      const files = Object.values(font.files)
      for (const file of files) expect(existsSync(join(root, font.id, file))).toBe(true)
      expect(readdirSync(join(root, font.id)).sort()).toEqual([...files, 'OFL.txt'].sort())
    }
    expect(readdirSync(root).sort()).toEqual(BUNDLED_FONTS.map(font => font.id).sort())
  })
})

describe('글꼴 관련 main 권한', () => {
  it('앱 페이지의 local-fonts 권한만 허용한다', () => {
    const page = 'app://bundle/index.html'
    expect(allowedPermission('local-fonts', 'app://bundle', page)).toBe(true)
    expect(allowedPermission('local-fonts', 'app://bundle/', page)).toBe(true)
    for (const origin of ['app://other', 'evil://bundle', 'https://example.com', 'file:///', 'null', '']) expect(allowedPermission('local-fonts', origin, page)).toBe(false)
    for (const permission of ['media', 'geolocation', 'notifications', 'clipboard-read']) expect(allowedPermission(permission, 'app://bundle', page)).toBe(false)
    expect(allowedPermission('local-fonts', 'http://localhost:5173', 'http://localhost:5173/')).toBe(true)
    expect(allowedPermission('local-fonts', 'http://localhost:5174', 'http://localhost:5173/')).toBe(false)
  })
  it('번들에서 글꼴은 /fonts/ 아래 woff2·ttf만 제공한다', () => {
    expect(bundleFileType('/fonts/jua/Jua-Regular.woff2', '.woff2')).toBe('font/woff2')
    expect(bundleFileType('/fonts/nanumpen/NanumPenScript-Regular.ttf', '.ttf')).toBe('font/ttf')
    expect(bundleFileType('/assets/x.woff2', '.woff2')).toBeNull()
    expect(bundleFileType('/fonts/jua/OFL.txt', '.txt')).toBeNull()
    expect(bundleFileType('/index.html', '.html')).toBe('text/html')
  })
})
