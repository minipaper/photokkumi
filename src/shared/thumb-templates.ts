import type { FontRef } from './fonts'
import { THEME_SLOTS, palette, type Palette, type ShapeItem, type ThemeSlot, type ThumbBackground } from './shapes'
import { DEFAULT_TEXT_STYLE, type TextAlign, type TextItem, type TextStyle } from './text'

/** A color: '#rrggbb', or a theme slot that follows the color theme. */
type Paint = string
/** Vertical position: a number starts a new column of texts at that y; `{ gap }` stacks under the previous text. */
type Top = number | { gap: number }
/**
 * Shape in template space (1080 square): x/y is the top-left corner before rotation.
 * `attach` moves it to texts after they are measured: around them (padding, minimum size) or just above/below.
 */
interface TShape { ellipse?: true; x: number; y: number; w: number; h: number; fill?: Paint; op?: number; line?: Paint; lw?: number; r?: number; shadow?: true; rot?: number
  attach?: { slots: string[]; edge: 'around' | 'top' | 'bottom'; gap?: number; pad?: [number, number] } }
/**
 * Text in template space. `x` is the left edge, center or right edge depending on `align`.
 * A column of stacked texts starts at `top`; `v` makes that y the column's center or bottom instead, so it grows both ways or upward.
 * `after` puts the left edge `x` px after another slot (tags in a row). Text wider than `max` shrinks to fit.
 */
interface TText { slot: string; text: string; font: FontRef; size: number; bold?: boolean; color: Paint; align?: TextAlign; x: number; top: Top; v?: 'center' | 'bottom'
  after?: string; max?: number; stroke?: [Paint, number]; box?: [Paint, number, boolean?]; shadow?: true; rot?: number }
export interface ThumbTemplate { id: string; name: string; kind: 'photo' | 'card'; palette: string; bg: Paint; dim?: number; shapes: TShape[]; texts: TText[] }

const C = 540, L = 90
const BG = '#2b2f38', INK = '#222222', GRAY = '#777777'
const T = (slot: string, text: string, font: FontRef, size: number, color: Paint, x: number, top: Top, more: Partial<TText> = {}): TText =>
  ({ slot, text, font, size, color, x, top, align: x === C ? 'center' : 'left', ...more })
const g = (gap: number) => ({ gap })
const P = 'pretendard', BH = 'blackhansans'
const TITLE = '블로그 썸네일\n만들기', SUB = '쉽고 빠르게 만드는 대표 이미지', KICK = '눈길을 사로잡는'

/** Built-in templates: about 70% photo background, 30% card news (no photo). All designed for this app. */
export const THUMB_TEMPLATES: readonly ThumbTemplate[] = [
  { id: 'p-newpost', name: 'NEW POST 왼쪽', kind: 'photo', palette: 'yellow', bg: BG, dim: 50, shapes: [], texts: [
    T('tag', 'NEW POST', P, 30, 'onAccent', L, 990, { v: 'bottom', bold: true, box: ['accent', 100] }),
    T('title', TITLE, BH, 128, '#ffffff', L, g(18)),
    T('sub', SUB, P, 36, '#e0e0e0', L, g(22))] },
  { id: 'p-accent-line', name: '강조 한 줄', kind: 'photo', palette: 'yellow', bg: BG, dim: 55,
    shapes: [{ x: 0, y: 1056, w: 1080, h: 24, fill: 'accent' }], texts: [
    T('kicker', '깔끔한', P, 64, '#ffffff', L, 540, { v: 'center' }),
    T('title', '블로그 썸네일', BH, 120, '#ffffff', L, g(6)),
    T('title2', '디자인', BH, 120, 'accent', L, g(0)),
    T('sub', KICK + ' 블로그 썸네일', P, 34, '#dddddd', L, g(28))] },
  { id: 'p-frame-accent', name: '컬러 테두리', kind: 'photo', palette: 'yellow', bg: BG, dim: 60,
    shapes: [{ x: 60, y: 60, w: 960, h: 960, op: 0, line: 'accent', lw: 14, r: 3 }], texts: [
    T('title', '깔끔한\n블로그 타이틀', BH, 124, '#ffffff', C, 500, { v: 'center', max: 860 }),
    T('sub', KICK + ' 블로그 썸네일', P, 36, '#e8e8e8', C, g(28), { max: 860 }),
    T('handle', '@my_blog', P, 28, 'onAccent', C, 900, { bold: true, box: ['accent', 100] })] },
  { id: 'p-color-box', name: '가운데 색 상자', kind: 'photo', palette: 'orange', bg: BG, dim: 20,
    shapes: [{ x: 170, y: 170, w: 740, h: 740, fill: 'accent', op: 95, shadow: true }], texts: [
    T('kicker', '눈에 띄는', P, 56, 'onAccent', C, 540, { v: 'center', max: 660 }),
    T('title', TITLE, BH, 104, 'onAccent', C, g(12), { max: 660 }),
    T('sub', SUB, P, 32, 'onAccent', C, g(26), { max: 660 })] },
  { id: 'p-highlight', name: '형광펜 강조', kind: 'photo', palette: 'yellow', bg: BG, dim: 50, shapes: [], texts: [
    T('kicker', '눈에 띄는', P, 64, '#ffffff', L, 560, { v: 'center' }),
    T('title', '블로그 썸네일', BH, 116, 'onAccent', L, g(14), { box: ['accent', 100, false] }),
    T('title2', '만들기', BH, 116, '#ffffff', L + 46, g(8)),
    T('sub', KICK + ' 블로그 썸네일', P, 34, '#dddddd', L + 46, g(30))] },
  { id: 'p-frame-white', name: '흰 액자', kind: 'photo', palette: 'sky', bg: BG, dim: 45,
    shapes: [{ x: 80, y: 80, w: 920, h: 920, op: 0, line: '#ffffff', lw: 10 }], texts: [
    T('kicker', '깔끔한', P, 72, '#ffffff', C, 530, { v: 'center', max: 820 }),
    T('title', '블로그\n썸네일', 'suit', 124, '#ffffff', C, g(6), { bold: true, max: 820 }),
    T('sub', KICK + ' 블로그 썸네일', P, 34, '#eeeeee', C, g(28), { max: 820 }),
    T('handle', '@my_blog', P, 24, '#1f1f1f', 1000, 948, { bold: true, align: 'right', box: ['#ffffff', 100] })] },
  { id: 'p-label', name: '머리말 라벨', kind: 'photo', palette: 'green', bg: BG, dim: 45, shapes: [], texts: [
    T('kicker', '시선을 사로잡는', P, 44, 'onAccent', L, 960, { v: 'bottom', bold: true, box: ['accent', 92, false] }),
    T('title', '블로그\n썸네일', BH, 150, '#ffffff', L, g(16)),
    T('sub', '첫 화면을 바꾸는 한 장', P, 34, '#dddddd', L, g(22))] },
  { id: 'p-hashtags', name: '해시태그', kind: 'photo', palette: 'blue', bg: BG, dim: 55, shapes: [], texts: [
    T('kicker', '트렌디한', P, 64, '#ffffff', L, 540, { v: 'center' }),
    T('title', '블로그 썸네일', BH, 116, '#ffffff', L, g(4)),
    T('sub', KICK + ' 블로그 썸네일', P, 34, '#dddddd', L, g(22)),
    T('tag', '#눈에 띄는', P, 30, 'onAccent', L, g(34), { bold: true, box: ['accent', 100] }),
    T('tag2', '#감각적인', P, 30, '#1f1f1f', 14, 0, { bold: true, box: ['#ffffff', 100], after: 'tag' }),
    T('tag3', '#트렌드', P, 30, '#ffffff', 14, 0, { bold: true, box: ['#333333', 100], after: 'tag2' })] },
  { id: 'p-bottom-white', name: '아래 흰 상자', kind: 'photo', palette: 'red', bg: BG, dim: 0,
    shapes: [{ x: 0, y: 640, w: 1080, h: 440, fill: '#ffffff' }, { x: L, y: 0, w: 80, h: 10, fill: 'accent', attach: { slots: ['kicker'], edge: 'top', gap: 16 } }], texts: [
    T('kicker', KICK, P, 40, 'accent', L, 870, { v: 'center', bold: true }),
    T('title', '블로그 썸네일', BH, 104, INK, L, g(10)),
    T('sub', SUB, P, 32, '#666666', L, g(18))] },
  { id: 'p-white-card', name: '반투명 흰 카드', kind: 'photo', palette: 'purple', bg: BG, dim: 15,
    shapes: [{ x: 150, y: 220, w: 780, h: 640, fill: '#ffffff', op: 88, r: 6, shadow: true, attach: { slots: ['kicker', 'title', 'sub'], edge: 'around', pad: [80, 70] } }], texts: [
    T('kicker', '시선 집중!', P, 44, 'accent', C, 540, { v: 'center', bold: true, max: 800 }),
    T('title', '블로그 썸네일\n디자인', BH, 110, INK, C, g(12), { max: 800 }),
    T('sub', '브랜드를 만드는 한 컷의 힘', P, 32, '#555555', C, g(26), { max: 800 })] },
  { id: 'p-circle', name: '원형 배지', kind: 'photo', palette: 'pink', bg: BG, dim: 25,
    shapes: [{ ellipse: true, x: 170, y: 170, w: 740, h: 740, fill: 'accent', op: 92 }], texts: [
    T('kicker', '오늘의 기록', P, 52, 'onAccent', C, 540, { v: 'center', max: 520 }),
    T('title', '블로그\n썸네일', BH, 120, 'onAccent', C, g(10), { max: 560 }),
    T('sub', '쉽고 빠르게 만드는', P, 32, 'onAccent', C, g(24), { max: 520 })] },
  { id: 'p-serif', name: '감성 명조', kind: 'photo', palette: 'brown', bg: BG, dim: 40,
    shapes: [{ x: 390, y: 0, w: 300, h: 3, fill: '#ffffff', attach: { slots: ['title'], edge: 'top', gap: 34 } },
      { x: 390, y: 0, w: 300, h: 3, fill: '#ffffff', attach: { slots: ['title'], edge: 'bottom', gap: 34 } }], texts: [
    T('kicker', '오늘의 이야기', 'notoserif', 32, '#ffffff', C, 530, { v: 'center' }),
    T('title', TITLE, 'notoserif', 96, '#ffffff', C, g(74), { bold: true }),
    T('sub', '천천히 기록하는 하루', 'notoserif', 34, '#eeeeee', C, g(74))] },
  { id: 'p-handwriting', name: '손글씨 메모', kind: 'photo', palette: 'yellow', bg: BG, dim: 30, shapes: [], texts: [
    T('kicker', '오늘의 일기', 'nanumpen', 96, 'accent', C, 540, { v: 'center', shadow: true }),
    T('title', TITLE, 'nanumpen', 180, '#ffffff', C, g(0), { shadow: true }),
    T('sub', SUB, P, 32, '#ffffff', C, g(20), { shadow: true })] },
  { id: 'p-cute', name: '귀여운 주아', kind: 'photo', palette: 'pink', bg: BG, dim: 20, shapes: [], texts: [
    T('kicker', '귀여운', 'jua', 70, '#ffffff', C, 540, { v: 'center', stroke: ['accent', 14] }),
    T('title', '블로그 썸네일\n만들기!', 'jua', 130, 'accent', C, g(10), { stroke: ['#ffffff', 12] }),
    T('sub', '쉽고 빠르게 꾸며요', 'jua', 42, 'onAccent', C, g(26), { box: ['accent', 100] })] },
  { id: 'p-variety', name: '예능 자막', kind: 'photo', palette: 'yellow', bg: BG, dim: 0, shapes: [], texts: [
    T('kicker', '오늘의 하이라이트', BH, 56, '#1f1f1f', C, 1000, { v: 'bottom', box: ['#ffffff', 100], rot: -4 }),
    T('title', '블로그 썸네일', BH, 150, 'accent', C, g(14), { stroke: ['#000000', 10], shadow: true }),
    T('sub', '이건 꼭 봐야 해!', BH, 64, '#ffffff', C, g(4), { stroke: ['#000000', 10] })] },
  { id: 'p-dark-band', name: '아래 어두운 띠', kind: 'photo', palette: 'sky', bg: BG, dim: 0,
    shapes: [{ x: 0, y: 560, w: 1080, h: 520, fill: '#000000', op: 62 }], texts: [
    T('kicker', KICK, P, 40, 'accent', L, 820, { v: 'center', bold: true }),
    T('title', TITLE, BH, 100, '#ffffff', L, g(10)),
    T('sub', SUB, P, 32, '#dddddd', L, g(20))] },
  { id: 'p-side-panel', name: '왼쪽 색 패널', kind: 'photo', palette: 'purple', bg: BG, dim: 0,
    shapes: [{ x: 0, y: 0, w: 520, h: 1080, fill: 'accent', op: 94 }], texts: [
    T('kicker', '깔끔한', P, 48, 'onAccent', 70, 560, { v: 'center', max: 400 }),
    T('title', '블로그\n썸네일\n만들기', BH, 120, 'onAccent', 70, g(10), { max: 400 }),
    T('sub', '대표 이미지 한 장', P, 32, 'onAccent', 70, g(30), { max: 400 })] },
  { id: 'p-split', name: '위 사진 아래 색', kind: 'photo', palette: 'mint', bg: BG, dim: 0,
    shapes: [{ x: 0, y: 600, w: 1080, h: 480, fill: 'soft' }], texts: [
    T('tag', 'NEW POST', P, 30, 'onAccent', C, 840, { v: 'center', bold: true, box: ['accent', 100] }),
    T('title', '블로그 썸네일', BH, 110, INK, C, g(22)),
    T('sub', SUB, P, 34, '#555555', C, g(22))] },
  { id: 'p-top5', name: 'TOP 순위', kind: 'photo', palette: 'orange', bg: BG, dim: 50, shapes: [], texts: [
    T('kicker', '꼭 가봐야 할', P, 52, '#ffffff', C, 540, { v: 'center', bold: true }),
    T('number', 'TOP 5', BH, 300, 'accent', C, g(-10), { shadow: true }),
    T('title', '서울 데이트 코스', BH, 110, '#ffffff', C, g(-10)),
    T('sub', '주말에 가기 좋은 곳만 골랐어요', P, 32, '#dddddd', C, g(24))] },
  { id: 'p-travel', name: '여행 날짜', kind: 'photo', palette: 'sky', bg: BG, dim: 35, shapes: [], texts: [
    T('tag', '2026. 11. 13', P, 34, '#1f1f1f', C, 540, { v: 'center', bold: true, box: ['#ffffff', 100] }),
    T('title', TITLE, 'dohyeon', 150, '#ffffff', C, g(24), { shadow: true }),
    T('sub', '서울 · 성수동', P, 40, '#ffffff', C, g(20), { bold: true, shadow: true })] },
  { id: 'p-review', name: '솔직 후기', kind: 'photo', palette: 'yellow', bg: BG, dim: 50, shapes: [], texts: [
    T('kicker', '내돈내산', P, 46, '#ffffff', C, 540, { v: 'center', bold: true }),
    T('title', '솔직 후기', BH, 150, '#ffffff', C, g(10)),
    T('deco', '★★★★★', P, 76, 'accent', C, g(16)),
    T('sub', '직접 써 보고 남기는 이야기', P, 34, '#dddddd', C, g(22))] },
  { id: 'p-bubble', name: '아래 흰 말풍선', kind: 'photo', palette: 'green', bg: BG, dim: 10,
    shapes: [{ x: 120, y: 640, w: 840, h: 320, fill: '#ffffff', r: 12, shadow: true, attach: { slots: ['kicker', 'title', 'sub'], edge: 'around', pad: [70, 40] } }], texts: [
    T('kicker', '오늘 뭐 먹지?', 'gaegu', 46, 'accent', C, 980, { v: 'bottom', bold: true, max: 820 }),
    T('title', '블로그 썸네일', 'jua', 100, INK, C, g(6), { max: 820 }),
    T('sub', SUB, 'gaegu', 38, '#555555', C, g(10), { max: 820 })] },
  { id: 'p-retro', name: '레트로', kind: 'photo', palette: 'orange', bg: BG, dim: 45, shapes: [], texts: [
    T('kicker', '그때 그 감성', 'dohyeon', 64, '#fff4d6', C, 540, { v: 'center' }),
    T('title', '블로그\n썸네일', 'dohyeon', 160, 'accent', C, g(10), { stroke: ['#fff4d6', 8], shadow: true }),
    T('sub', SUB, P, 32, '#fff4d6', C, g(30), { bold: true })] },
  { id: 'p-minimal', name: '미니멀 하단', kind: 'photo', palette: 'purple', bg: BG, dim: 35,
    shapes: [{ x: 500, y: 0, w: 80, h: 4, fill: '#ffffff', attach: { slots: ['title'], edge: 'bottom', gap: 20 } }], texts: [
    T('kicker', '심플한', P, 40, '#ffffff', C, 1000, { v: 'bottom' }),
    T('title', '블로그 썸네일', P, 96, '#ffffff', C, g(8), { bold: true }),
    T('sub', SUB, P, 30, '#eeeeee', C, g(44)),
    T('handle', '@my_blog', P, 24, '#dddddd', C, g(30))] },

  { id: 'c-memo', name: '메모지', kind: 'card', palette: 'pink', bg: 'soft', shapes: [
    { x: 160, y: 150, w: 760, h: 780, fill: '#ffffff', r: 1, shadow: true, rot: -3 },
    { x: 470, y: 112, w: 140, h: 64, fill: 'accent', op: 80, rot: -6 }], texts: [
    T('kicker', KICK, P, 44, 'accent', C, 560, { v: 'center', bold: true, max: 640 }),
    T('title', TITLE, BH, 108, INK, C, g(14), { max: 640 }),
    T('sub', SUB, P, 32, GRAY, C, g(26), { max: 640 }),
    T('handle', '@my_blog', P, 24, '#aaaaaa', C, g(40))] },
  { id: 'c-spring', name: '스프링 노트', kind: 'card', palette: 'blue', bg: 'accent', shapes: [
    { x: 150, y: 170, w: 780, h: 760, fill: '#ffffff', r: 1, shadow: true },
    ...Array.from({ length: 9 }, (_, index): TShape => ({ ellipse: true, x: 200 + index * 85, y: 150, w: 28, h: 28, fill: '#2b2b2b' }))], texts: [
    T('kicker', KICK, P, 44, '#888888', C, 560, { v: 'center', max: 680 }),
    T('title', '블로그', BH, 130, INK, C, g(10), { max: 680 }),
    T('title2', '카드뉴스', BH, 130, 'accent', C, g(0), { max: 680 }),
    T('sub', SUB, P, 32, '#888888', C, g(30), { max: 680 })] },
  { id: 'c-circle', name: '큰 원', kind: 'card', palette: 'green', bg: 'accent', shapes: [
    { ellipse: true, x: 110, y: 110, w: 860, h: 860, fill: '#ffffff' }], texts: [
    T('kicker', KICK, P, 44, 'accent', C, 540, { v: 'center', bold: true, max: 600 }),
    T('title', TITLE, BH, 116, INK, C, g(12), { max: 680 }),
    T('sub', SUB, P, 32, GRAY, C, g(26), { max: 600 })] },
  { id: 'c-outline', name: '테두리 카드', kind: 'card', palette: 'mint', bg: '#f3f1ec', shapes: [
    { x: 130, y: 130, w: 820, h: 820, fill: '#ffffff', line: INK, lw: 6, r: 4 }], texts: [
    T('tag', 'NEW POST', P, 28, '#ffffff', C, 540, { v: 'center', bold: true, box: [INK, 100] }),
    T('title', '블로그', BH, 130, INK, C, g(24), { max: 720 }),
    T('title2', '타이틀', BH, 140, 'accent', C, g(0), { max: 720 }),
    T('sub', '시선을 사로잡는 블로그 썸네일', P, 30, GRAY, C, g(30), { max: 720 })] },
  { id: 'c-blocks', name: '컬러 블록', kind: 'card', palette: 'yellow', bg: 'soft', shapes: [
    { x: 0, y: 0, w: 540, h: 540, fill: 'accent' }, { x: 540, y: 540, w: 540, h: 540, fill: 'accent' },
    { x: 160, y: 160, w: 760, h: 760, fill: '#ffffff', line: INK, lw: 6, r: 10 }], texts: [
    T('kicker', KICK, P, 40, '#666666', C, 540, { v: 'center', bold: true, max: 640 }),
    T('title', TITLE, BH, 108, INK, C, g(14), { max: 640 }),
    T('sub', SUB, P, 30, GRAY, C, g(26), { max: 640 })] },
  { id: 'c-speech', name: '말풍선', kind: 'card', palette: 'purple', bg: 'soft', shapes: [
    { x: 130, y: 190, w: 820, h: 560, fill: '#ffffff', line: INK, lw: 8, r: 14 },
    { ellipse: true, x: 240, y: 790, w: 76, h: 76, fill: '#ffffff', line: INK, lw: 6 },
    { ellipse: true, x: 190, y: 890, w: 44, h: 44, fill: '#ffffff', line: INK, lw: 6 }], texts: [
    T('kicker', '귀여운', 'jua', 56, 'accent', C, 470, { v: 'center', max: 700 }),
    T('title', TITLE, 'jua', 110, INK, C, g(6), { max: 700 }),
    T('sub', '쉽고 빠르게 꾸며요', 'jua', 40, '#666666', C, g(16), { max: 700 }),
    T('handle', '@my_blog', P, 26, '#555555', 990, 1000, { align: 'right' })] },
  { id: 'c-quote', name: '따옴표', kind: 'card', palette: 'brown', bg: '#3a3a3a', shapes: [
    { x: 110, y: 110, w: 860, h: 860, fill: '#ffffff' }, { x: 190, y: 0, w: 700, h: 3, fill: '#dddddd', attach: { slots: ['title'], edge: 'bottom', gap: 34 } }], texts: [
    T('deco', '“', 'notoserif', 180, 'accent', C, 520, { v: 'center', bold: true }),
    T('kicker', '오늘의 기록', P, 36, 'accent', C, g(-60), { bold: true, max: 720 }),
    T('title', TITLE, P, 92, INK, C, g(16), { bold: true, max: 720 }),
    T('sub', '천천히 기록하는 하루', P, 30, GRAY, C, g(70), { max: 720 })] },
  { id: 'c-lined', name: '줄 노트', kind: 'card', palette: 'orange', bg: 'accent', shapes: [
    { x: 140, y: 140, w: 800, h: 800, fill: '#fffdf7', r: 1, shadow: true },
    ...[380, 500, 620, 740, 860].map((y): TShape => ({ x: 190, y, w: 700, h: 3, fill: '#ece5d8' })),
    { x: 230, y: 160, w: 3, h: 760, fill: 'accent', op: 60 }], texts: [
    T('kicker', '오늘의 일기', 'gaegu', 56, 'accent', C, 560, { v: 'center', bold: true, max: 680 }),
    T('title', TITLE, 'gaegu', 120, '#333333', C, g(10), { bold: true, max: 680 }),
    T('sub', SUB, 'gaegu', 40, GRAY, C, g(20), { max: 680 })] },
  { id: 'c-ring', name: '동그라미 강조', kind: 'card', palette: 'red', bg: '#fdf6ee', shapes: [
    { ellipse: true, x: 90, y: 90, w: 60, h: 60, fill: 'soft' }, { ellipse: true, x: 930, y: 930, w: 60, h: 60, fill: 'accent' },
    { ellipse: true, x: 0, y: 0, w: 500, h: 210, op: 0, line: 'accent', lw: 8, rot: -4, attach: { slots: ['title2'], edge: 'around', pad: [70, 20] } }], texts: [
    T('kicker', KICK, P, 44, 'accent', C, 560, { v: 'center', bold: true }),
    T('title', '블로그', BH, 120, INK, C, g(10)),
    T('title2', '썸네일', BH, 130, INK, C, g(30), { max: 760 }),
    T('sub', SUB, P, 32, GRAY, C, g(50))] },
  { id: 'c-bold', name: '큰 글자', kind: 'card', palette: 'blue', bg: 'accent', shapes: [
    { x: 60, y: 60, w: 960, h: 960, op: 0, line: 'onAccent', lw: 6 }], texts: [
    T('kicker', KICK, P, 48, 'onAccent', C, 560, { v: 'center', bold: true, max: 840 }),
    T('title', '블로그\n썸네일', BH, 160, 'onAccent', C, g(16), { max: 860 }),
    T('sub', SUB, P, 34, 'onAccent', C, g(30), { max: 840 })] }
]
export const templateById = (id: string | undefined) => THUMB_TEMPLATES.find(item => item.id === id)

const isSlot = (paint: Paint): paint is ThemeSlot => THEME_SLOTS.includes(paint as ThemeSlot)
const paint = (value: Paint, colors: Palette) => isSlot(value) ? colors[value] : value
/** Shapes and background of a template in the given colors; colors from theme slots stay linked to the theme. */
export function templateBase(template: ThumbTemplate, colors: Palette, keep: Pick<ThumbBackground, 'photoId' | 'zoom' | 'focusX' | 'focusY'>, newId: () => string): { background: ThumbBackground; shapes: ShapeItem[] } {
  const background: ThumbBackground = { photoId: keep.photoId, zoom: keep.zoom, focusX: keep.focusX, focusY: keep.focusY, color: paint(template.bg, colors), dim: template.kind === 'photo' ? template.dim ?? 40 : 0 }
  if (template.kind === 'card') background.hidePhoto = true
  if (isSlot(template.bg)) background.colorSlot = template.bg
  const shapes = template.shapes.map((shape): ShapeItem => {
    const themed: ShapeItem['themed'] = {}
    if (shape.fill && isSlot(shape.fill)) themed.fill = shape.fill
    if (shape.line && isSlot(shape.line)) themed.stroke = shape.line
    return { id: newId(), kind: shape.ellipse ? 'ellipse' : 'rect', x: shape.x + shape.w / 2, y: shape.y + shape.h / 2, width: shape.w, height: shape.h, rotation: shape.rot ?? 0,
      fill: paint(shape.fill ?? '#ffffff', colors), fillOpacity: shape.op ?? (shape.fill ? 100 : 0), stroke: paint(shape.line ?? '#000000', colors), strokeWidth: shape.line ? shape.lw ?? 4 : 0,
      radius: shape.r ?? 0, shadow: !!shape.shadow, ...(Object.keys(themed).length ? { themed } : {}) }
  })
  return { background, shapes }
}
/** Texts of a template before measuring: the caller measures each in its font and places it with `placeText`. */
export function templateTexts(template: ThumbTemplate, colors: Palette, contents: Readonly<Record<string, string>>, newId: () => string) {
  return template.texts.map(spec => {
    const style: TextStyle = { ...DEFAULT_TEXT_STYLE, font: spec.font, bold: !!spec.bold, color: paint(spec.color, colors), align: spec.align ?? 'left',
      strokeColor: paint(spec.stroke?.[0] ?? '#000000', colors), strokeWidth: spec.stroke?.[1] ?? 0,
      boxColor: paint(spec.box?.[0] ?? '#000000', colors), boxOpacity: spec.box?.[1] ?? 0, boxRound: spec.box?.[2] ?? true, shadow: !!spec.shadow }
    const themed: TextItem['themed'] = {}
    if (isSlot(spec.color)) themed.color = spec.color
    if (spec.stroke && isSlot(spec.stroke[0])) themed.strokeColor = spec.stroke[0]
    if (spec.box && isSlot(spec.box[0])) themed.boxColor = spec.box[0]
    const item = { id: newId(), slot: spec.slot, text: contents[spec.slot] ?? spec.text, fontSize: spec.size, style, rotation: spec.rot ?? 0, ...(Object.keys(themed).length ? { themed } : {}) }
    const align = spec.align ?? 'left'
    const max = spec.max ?? (align === 'left' ? 1010 - spec.x : align === 'right' ? spec.x - 70 : 960)
    return { item, anchor: <TextAnchor>{ slot: spec.slot, x: spec.x, top: spec.top, v: spec.v, align, after: spec.after, max } }
  })
}
export interface TextAnchor { slot: string; x: number; top: Top; v?: 'center' | 'bottom'; align: TextAlign; after?: string; max: number }
type Anchor = TextAnchor
export interface TextBox { x: number; y: number; width: number; height: number }
/**
 * Centers of measured template texts: columns stack from their start (`top`, or centered/bottom-aligned with `v`),
 * `after` texts sit in the same row to the right of another slot.
 */
export function arrangeTexts(texts: readonly { anchor: Anchor; width: number; height: number }[]): { x: number; y: number }[] {
  const tops: number[] = [], lefts: number[] = [], columns: { members: number[]; v?: 'center' | 'bottom'; y: number }[] = []
  let cursor = 0
  texts.forEach(({ anchor, width, height }, index) => {
    const previous = anchor.after ? texts.findIndex(item => item.anchor.slot === anchor.after) : -1
    if (previous >= 0 && previous < index) {
      tops[index] = tops[previous]; lefts[index] = lefts[previous] + texts[previous].width + anchor.x
      columns.at(-1)?.members.push(index)
      cursor = Math.max(cursor, tops[index] + height)
      return
    }
    if (typeof anchor.top === 'number' || !columns.length) {
      const y = typeof anchor.top === 'number' ? anchor.top : 0
      columns.push({ members: [index], v: anchor.v, y }); tops[index] = y
    } else { tops[index] = cursor + anchor.top.gap; columns.at(-1)!.members.push(index) }
    cursor = tops[index] + height
    lefts[index] = anchor.align === 'center' ? anchor.x - width / 2 : anchor.align === 'right' ? anchor.x - width : anchor.x
  })
  for (const column of columns) {
    if (!column.v) continue
    const top = Math.min(...column.members.map(index => tops[index])), bottom = Math.max(...column.members.map(index => tops[index] + texts[index].height))
    const shift = column.v === 'center' ? column.y - (top + bottom) / 2 : column.y - bottom
    for (const index of column.members) tops[index] += shift
  }
  return texts.map(({ width, height }, index) => ({ x: lefts[index] + width / 2, y: tops[index] + height / 2 }))
}
/** Shapes that follow texts (a card around the title column, a line under the title, a ring around a word). */
export function attachShapes(template: ThumbTemplate, shapes: readonly ShapeItem[], boxes: ReadonlyMap<string, TextBox>): ShapeItem[] {
  return shapes.map((shape, index) => {
    const attach = template.shapes[index]?.attach
    const targets = attach?.slots.map(slot => boxes.get(slot)).filter(box => !!box) ?? []
    if (!attach || !targets.length) return shape
    const left = Math.min(...targets.map(box => box.x - box.width / 2)), right = Math.max(...targets.map(box => box.x + box.width / 2))
    const top = Math.min(...targets.map(box => box.y - box.height / 2)), bottom = Math.max(...targets.map(box => box.y + box.height / 2))
    if (attach.edge === 'top') return { ...shape, y: top - (attach.gap ?? 0) - shape.height / 2 }
    if (attach.edge === 'bottom') return { ...shape, y: bottom + (attach.gap ?? 0) + shape.height / 2 }
    const [padX, padY] = attach.pad ?? [0, 0]
    return { ...shape, x: (left + right) / 2, y: (top + bottom) / 2, width: right - left + 2 * padX, height: bottom - top + 2 * padY }
  })
}
/** Text contents to carry into another template: same slots keep their text; a title split over two slots is joined or split. */
export function carryContents(texts: readonly Pick<TextItem, 'slot' | 'text'>[], target: ThumbTemplate): Record<string, string> {
  const current = new Map(texts.filter(item => item.slot).map(item => [item.slot!, item.text]))
  const slots = new Set(target.texts.map(item => item.slot))
  const contents: Record<string, string> = {}
  for (const [slot, text] of current) if (slots.has(slot)) contents[slot] = text
  const title = current.get('title'), title2 = current.get('title2')
  if (slots.has('title') && !slots.has('title2') && title !== undefined && title2 !== undefined) contents.title = `${title}\n${title2}`
  if (slots.has('title') && slots.has('title2') && title !== undefined && title2 === undefined) {
    const lines = title.split('\n')
    if (lines.length > 1) { contents.title = lines.slice(0, -1).join('\n'); contents.title2 = lines.at(-1)! }
  }
  return contents
}
/** The palette a template is drawn in: the chosen theme, else the template's own. */
export const templateColors = (template: ThumbTemplate, theme: string | undefined) => palette(theme) ?? palette(template.palette)!
