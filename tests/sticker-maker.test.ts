import { afterEach, beforeAll, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PNG } from 'pngjs'
import { STICKER_ICONS, stickerIcon } from '../src/shared/sticker-icons'
import {
  DEFAULT_MAKER, KIND_CATEGORIES, MAX_BODY_LINES, PHRASES, STICKER_DESIGNS, STICKER_SIZES, bodyLines, parseMarks, phraseContent, plainText, stickerName,
  validContent, validMakerRequest, validMakerState, validMyStickers, validSpec, type StickerSpec
} from '../src/shared/sticker-maker'
import { buildSticker, luminance, opaqueBounds, stickerColors, type Ctx } from '../src/renderer/sticker-draw'
import { StickerLibrary } from '../src/main/library'

/** Records canvas calls; text is measured as one font size per character. */
function mockContext() {
  const texts: { text: string; color: string; font: string }[] = []
  const calls: string[] = []
  let font = '400 10px sans-serif', fillStyle = '#000000'
  const size = () => Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 10)
  const target: Record<string, unknown> = {
    measureText: (text: string) => ({ width: [...text].length * size() }),
    fillText: (text: string) => { texts.push({ text, color: fillStyle, font }) }
  }
  const context = new Proxy(target, {
    get: (object, key: string) => key in object ? object[key] : key === 'font' ? font : key === 'fillStyle' ? fillStyle : (...args: unknown[]) => { calls.push(`${key}(${args.length})`) },
    set: (object, key: string, value) => { if (key === 'font') font = value; else if (key === 'fillStyle') fillStyle = value; else object[key] = value; return true }
  })
  return { context: context as unknown as Ctx, texts, calls }
}
beforeAll(() => { (globalThis as Record<string, unknown>).Path2D ??= class { constructor(public d: string) {} } })
const folders: string[] = []
afterEach(async () => { await Promise.all(folders.splice(0).map(path => fs.rm(path, { recursive: true, force: true }))) })
const spec = (design: string, patch: Partial<StickerSpec['content']> = {}): StickerSpec => {
  const kind = STICKER_DESIGNS.find(item => item.id === design)!.kind
  return { design, content: { ...DEFAULT_MAKER.contents[kind], ...patch }, style: DEFAULT_MAKER.style }
}

it('[ ]로 감싼 글자만 강조로 나누고 짝 없는 괄호는 글자 그대로 둔다', () => {
  expect(parseMarks('업체로부터 [제품]을 받아')).toEqual([{ text: '업체로부터 ', mark: false }, { text: '제품', mark: true }, { text: '을 받아', mark: false }])
  expect(parseMarks('[위치] 안내')).toEqual([{ text: '위치', mark: true }, { text: ' 안내', mark: false }])
  expect(parseMarks('[a][b]')).toEqual([{ text: 'ab', mark: true }])
  expect(parseMarks('[참고 영상')).toEqual([{ text: '[참고 영상', mark: false }])
  expect(parseMarks('a] [] b')).toEqual([{ text: 'a] [] b', mark: false }])
  expect(parseMarks('')).toEqual([])
  expect(plainText('[제품]과 [원고료]')).toBe('제품과 원고료')
  expect(bodyLines('\n첫 줄\n\n둘째 줄  \n')).toEqual(['첫 줄', '', '둘째 줄'])
})

it('디자인·문구·아이콘 목록: 종류별 디자인, 문구 내용은 한도 안이고 아이콘이 있다', () => {
  expect(STICKER_DESIGNS.filter(item => item.kind === 'notice')).toHaveLength(10)
  expect(STICKER_DESIGNS.filter(item => item.kind === 'heading')).toHaveLength(6)
  expect(STICKER_DESIGNS.filter(item => item.kind === 'end')).toHaveLength(3)
  for (const list of [STICKER_DESIGNS, PHRASES, STICKER_ICONS]) expect(new Set(list.map(item => item.id)).size).toBe(list.length)
  expect(STICKER_ICONS.length).toBeGreaterThanOrEqual(30)
  for (const phrase of PHRASES) {
    expect(validContent(phraseContent(phrase)), phrase.id).toBe(true)
    expect(stickerIcon(phrase.icon), phrase.id).toBeTruthy()
    if (phrase.kind === 'notice') expect(bodyLines(phrase.body!).flatMap(line => parseMarks(line)).some(item => item.mark), phrase.id).toBe(true)
  }
  // Disclosure sentences say what was received (제공·지원·협찬·대여·수수료·구매·광고).
  for (const phrase of PHRASES.filter(item => item.kind === 'notice')) expect(phrase.body, phrase.id).toMatch(/제공|지원|협찬|대여|수수료|구매|광고|비용|포인트/)
  expect(PHRASES.filter(item => item.kind === 'notice').length).toBeGreaterThanOrEqual(20)
  expect(PHRASES.filter(item => item.kind === 'heading').length).toBeGreaterThanOrEqual(15)
  expect(KIND_CATEGORIES).toEqual({ notice: '공정위', heading: '소제목', end: '마무리' })
})

it('모든 디자인을 기본 내용과 크기마다 그리고, 강조 글자는 강조색으로 쓴다', () => {
  for (const design of STICKER_DESIGNS) {
    for (const { size } of STICKER_SIZES) {
      const { context, texts } = mockContext()
      const value = { ...spec(design.id), style: { ...DEFAULT_MAKER.style, size } }
      const box = buildSticker(context, value)
      expect(box.w, design.id).toBeGreaterThan(size * 2)
      expect(box.h, design.id).toBeGreaterThan(size)
      box.draw(context, 0, 0)
      const drawn = texts.map(item => item.text).join('')
      for (const field of ['title', 'body', 'caption'] as const) {
        if (!design.fields.includes(field)) continue
        for (const segment of parseMarks(value.content[field].replace(/\n/g, ''))) expect(drawn, `${design.id} ${field}`).toContain(segment.text.trim())
      }
      if (!design.fields.includes('body')) expect(drawn).not.toContain('포스팅')
    }
  }
  const { context, texts } = mockContext()
  buildSticker(context, spec('n-plain')).draw(context, 0, 0)
  const colors = stickerColors(DEFAULT_MAKER.style.ink, DEFAULT_MAKER.style.accent)
  expect(texts.find(item => item.text === '제품')?.color).toBe(colors.text)
  expect(texts.find(item => item.text === '을 무상으로 제공받아')?.color).toBe(DEFAULT_MAKER.style.ink)
  expect(texts.every(item => item.font.includes('"PK gowundodum"'))).toBe(true)
})

it('긴 줄은 넓게, 줄이 늘면 높게, 빈 내용은 그리지 않는다', () => {
  const { context } = mockContext()
  const short = buildSticker(context, spec('n-card', { body: '한 줄' }))
  const long = buildSticker(context, spec('n-card', { body: '아주 긴 한 줄 문장을 넣어 봅니다 아주 긴 한 줄 문장' }))
  const tall = buildSticker(context, spec('n-card', { body: '한 줄\n둘\n셋\n넷' }))
  expect(long.w).toBeGreaterThan(short.w)
  expect(tall.h).toBeGreaterThan(short.h)
  expect(buildSticker(context, spec('n-badge', { title: '  ', icon: '' })).w).toBe(0)
  expect(buildSticker(context, spec('n-plain', { body: '' })).w).toBe(0)
  // Fields a design does not use are ignored (badge has no body, plain has no title).
  expect(buildSticker(context, spec('n-badge', { body: '아주 긴 문장 '.repeat(5) })).w).toBe(buildSticker(context, spec('n-badge')).w)
  expect(() => buildSticker(context, { ...spec('n-plain'), design: 'nope' })).toThrow('디자인')
})

it('밝은 강조색은 글자에 쓸 때 진하게 바꾸고, 배지 글자는 배경과 대비되는 색을 쓴다', () => {
  const yellow = stickerColors('#3b3f47', '#f5c518'), blue = stickerColors('#3b3f47', '#5b7cfa')
  expect(luminance(yellow.text)).toBeLessThan(luminance('#f5c518'))
  expect(yellow.on).toBe('#26282d')
  expect(blue.text).toBe('#5b7cfa')
  expect(blue.on).toBe('#ffffff')
  expect(luminance(blue.soft)).toBeGreaterThan(0.6)
})

it('투명 여백을 잘라 낼 범위를 찾는다', () => {
  const data = new Uint8ClampedArray(5 * 4 * 4)
  expect(opaqueBounds(data, 5, 4)).toBeNull()
  data[(1 * 5 + 2) * 4 + 3] = 255; data[(3 * 5 + 3) * 4 + 3] = 40; data[(0 * 5 + 0) * 4 + 3] = 3
  expect(opaqueBounds(data, 5, 4)).toEqual({ x: 2, y: 1, width: 2, height: 3 })
})

it('저장 이름·상태·내 스티커·저장 요청 검증', () => {
  expect(stickerName(spec('n-pill'))).toBe('제품 제공')
  expect(stickerName(spec('n-plain'))).toBe('본 포스팅은 업체로부터')
  expect(stickerName(spec('h-quote'))).toBe('위치 안내')
  expect(stickerName(spec('n-pill', { title: '', body: '' }))).toBe('스티커')
  expect(validMakerState(DEFAULT_MAKER)).toBe(true)
  expect(validMakerState({ ...DEFAULT_MAKER, design: 'gone' })).toBe(false)
  expect(validMakerState({ ...DEFAULT_MAKER, style: { ...DEFAULT_MAKER.style, size: 25 } })).toBe(false)
  expect(validMakerState({ ...DEFAULT_MAKER, style: { ...DEFAULT_MAKER.style, font: 'system:Bad"Font' } })).toBe(false)
  expect(validMakerState({ ...DEFAULT_MAKER, contents: { ...DEFAULT_MAKER.contents, end: { ...DEFAULT_MAKER.contents.end, icon: 'nope' } } })).toBe(false)
  expect(validContent({ ...DEFAULT_MAKER.contents.notice, body: Array(MAX_BODY_LINES + 1).fill('줄').join('\n') })).toBe(false)
  expect(validContent({ ...DEFAULT_MAKER.contents.notice, title: '제목\n둘' })).toBe(false)
  expect(validContent({ ...DEFAULT_MAKER.contents.notice, extra: 1 })).toBe(false)
  expect(validSpec(spec('e-ribbon'))).toBe(true)
  expect(validMyStickers([{ id: 'a', ...spec('h-tab') }])).toBe(true)
  expect(validMyStickers([{ id: 'a', ...spec('h-tab'), preview: 'x' }])).toBe(false)
  const png = new Uint8Array([137, 80, 78, 71])
  expect(validMakerRequest({ items: [{ name: '제품 제공', png }], category: '공정위' })).toBe(true)
  expect(validMakerRequest({ items: [], category: '' })).toBe(false)
  expect(validMakerRequest({ items: [{ name: '  ', png }], category: '' })).toBe(false)
  expect(validMakerRequest({ items: [{ name: 'a', png: [1, 2] }], category: '' })).toBe(false)
  expect(validMakerRequest({ items: [{ name: 'a\u0000', png }], category: '' })).toBe(false)
  expect(validMakerRequest({ items: Array(41).fill({ name: 'a', png }), category: '' })).toBe(false)
})

it('만든 스티커 PNG를 라이브러리 분류에 넣고 같은 그림은 한 번만 넣는다', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'kkumi-maker-')); folders.push(root)
  const library = new StickerLibrary(root, bytes => PNG.sync.write(PNG.sync.read(Buffer.from(bytes))))
  await library.load()
  const image = (shade: number) => { const p = new PNG({ width: 6, height: 3 }); p.data.fill(shade); return PNG.sync.write(p) }
  const first = await library.importImages([{ name: '제품 제공', bytes: image(100) }, { name: '원고료 지원', bytes: image(150) }], '공정위')
  expect(first.stickers.map(item => [item.name, item.category, item.originalName])).toEqual([['제품 제공', '공정위', '제품 제공.png'], ['원고료 지원', '공정위', '원고료 지원.png']])
  const again = await library.importImages([{ name: '다른 이름', bytes: image(100) }], '공정위')
  expect(again.stickers).toHaveLength(2)
  expect(again.importedIds).toEqual([first.importedIds[0]])
  await expect(library.importImages([{ name: 'JPG', bytes: new Uint8Array([0xff, 0xd8, 0xff]) }], '')).rejects.toThrow()
  expect(library.list()).toHaveLength(2)
})
