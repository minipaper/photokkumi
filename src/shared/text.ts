import { validPlacement, type Placement } from './model'
import { DEFAULT_FONT, validFontRef, type FontRef } from './fonts'
export type TextAlign = 'left' | 'center' | 'right'
/** Look of a text item. Sizes in percent are relative to the font size so a resize keeps proportions. */
export interface TextStyle {
  font: FontRef
  bold: boolean
  color: string
  align: TextAlign
  /** Outline drawn outside the glyphs; width 0 = none, 1~30 % of the font size. */
  strokeColor: string
  strokeWidth: number
  /** Background box behind all lines; opacity 0 = no box. */
  boxColor: string
  boxOpacity: number
  boxRound: boolean
  shadow: boolean
}
/**
 * Text placed on a photo. (x, y) is the box center in logical photo pixels, rotation in degrees.
 * width/height are the measured box (glyphs + outline + box padding) and scale together with fontSize.
 */
export interface TextItem extends Placement { id: string; text: string; fontSize: number; style: TextStyle }
export const MAX_TEXTS = 50
export const MAX_TEXT_LENGTH = 500
export const MIN_FONT_SIZE = 4
export const MAX_FONT_SIZE = 4000
export const DEFAULT_TEXT = '텍스트'
export const DEFAULT_TEXT_STYLE: TextStyle = {
  font: DEFAULT_FONT, bold: true, color: '#ffffff', align: 'center',
  strokeColor: '#000000', strokeWidth: 8, boxColor: '#000000', boxOpacity: 0, boxRound: true, shadow: false
}
/**
 * Quick looks, 7 per row. Rows 1~2 only change colors/outline/box/shadow and keep the user's font and size;
 * row 3 are templates that also pick a bundled font. Each pairs the text with an outline or box so it reads on any photo.
 */
export const TEXT_PRESETS: readonly { name: string; style: Partial<TextStyle> }[] = [
  { name: '흰 글자 + 검은 외곽선', style: { color: '#ffffff', strokeColor: '#000000', strokeWidth: 8, boxOpacity: 0, shadow: false } },
  { name: '검은 글자 + 흰 외곽선', style: { color: '#111111', strokeColor: '#ffffff', strokeWidth: 8, boxOpacity: 0, shadow: false } },
  { name: '노란 자막', style: { color: '#ffe14d', strokeColor: '#1a1a1a', strokeWidth: 10, boxOpacity: 0, shadow: true } },
  { name: '반투명 검은 상자', style: { color: '#ffffff', strokeWidth: 0, boxColor: '#000000', boxOpacity: 55, boxRound: true, shadow: false } },
  { name: '흰 상자', style: { color: '#222222', strokeWidth: 0, boxColor: '#ffffff', boxOpacity: 90, boxRound: true, shadow: false } },
  { name: '분홍 + 흰 외곽선', style: { color: '#ff5c93', strokeColor: '#ffffff', strokeWidth: 12, boxOpacity: 0, shadow: false } },
  { name: '그림자만', style: { color: '#ffffff', strokeWidth: 0, boxOpacity: 0, shadow: true } },

  { name: '빨강 + 흰 외곽선', style: { color: '#ff3b30', strokeColor: '#ffffff', strokeWidth: 10, boxOpacity: 0, shadow: false } },
  { name: '하늘색 + 남색 외곽선', style: { color: '#8fd3ff', strokeColor: '#1d3557', strokeWidth: 10, boxOpacity: 0, shadow: false } },
  { name: '보라 + 흰 외곽선', style: { color: '#7b5cff', strokeColor: '#ffffff', strokeWidth: 10, boxOpacity: 0, shadow: true } },
  { name: '민트 상자', style: { color: '#0f3d33', strokeWidth: 0, boxColor: '#9ef0d0', boxOpacity: 92, boxRound: true, shadow: false } },
  { name: '노란 상자', style: { color: '#222222', strokeWidth: 0, boxColor: '#ffe14d', boxOpacity: 95, boxRound: true, shadow: false } },
  { name: '빨간 띠 + 흰 글자', style: { color: '#ffffff', strokeWidth: 0, boxColor: '#e63946', boxOpacity: 95, boxRound: false, shadow: false } },
  { name: '남색 반투명 상자', style: { color: '#ffffff', strokeWidth: 0, boxColor: '#1d3557', boxOpacity: 70, boxRound: true, shadow: false } },

  { name: '예능 자막 (검은고딕)', style: { font: 'blackhansans', bold: false, color: '#ffe14d', strokeColor: '#000000', strokeWidth: 12, boxOpacity: 0, shadow: true } },
  { name: '귀여운 분홍 (주아)', style: { font: 'jua', bold: false, color: '#ff7eb6', strokeColor: '#ffffff', strokeWidth: 14, boxOpacity: 0, shadow: false } },
  { name: '손글씨 메모 (나눔손글씨 펜)', style: { font: 'nanumpen', bold: false, color: '#ffffff', strokeWidth: 0, boxOpacity: 0, shadow: true } },
  { name: '감성 명조 (본명조)', style: { font: 'notoserif', bold: false, color: '#ffffff', strokeWidth: 0, boxColor: '#000000', boxOpacity: 35, boxRound: false, shadow: false } },
  { name: '레트로 (도현)', style: { font: 'dohyeon', bold: false, color: '#ff6b35', strokeColor: '#fff4d6', strokeWidth: 10, boxOpacity: 0, shadow: false } },
  { name: '말풍선 (동글)', style: { font: 'dongle', bold: true, color: '#333333', strokeWidth: 0, boxColor: '#ffffff', boxOpacity: 95, boxRound: true, shadow: false } },
  { name: '붓글씨 (나눔손글씨 붓)', style: { font: 'nanumbrush', bold: false, color: '#111111', strokeColor: '#ffffff', strokeWidth: 10, boxOpacity: 0, shadow: false } }
]
/** A look the user saved: the whole style plus the size relative to the photo's short edge (no text content). */
export interface MyPreset { id: string; style: TextStyle; relSize: number }
export const MAX_MY_PRESETS = 20
export const validRelSize = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1
export function validMyPresets(value: unknown): value is MyPreset[] {
  return Array.isArray(value) && value.length <= MAX_MY_PRESETS && value.every(item => !!item && typeof item === 'object'
    && typeof item.id === 'string' && item.id.length <= 64 && validTextStyle(item.style) && validRelSize(item.relSize))
}
/** Same look as an existing preset (sizes within 0.1% of the short edge count as equal). */
export const samePreset = (a: Omit<MyPreset, 'id'>, b: Omit<MyPreset, 'id'>) =>
  Math.abs(a.relSize - b.relSize) < 0.001 && (Object.keys(a.style) as (keyof TextStyle)[]).every(key => a.style[key] === b.style[key])
const COLOR = /^#[0-9a-f]{6}$/i
const intIn = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
export function validTextStyle(value: unknown): value is TextStyle {
  const v = value as Record<string, unknown> | null
  return !!v && typeof v === 'object' && validFontRef(v.font) && typeof v.bold === 'boolean'
    && typeof v.color === 'string' && COLOR.test(v.color) && ['left', 'center', 'right'].includes(v.align as string)
    && typeof v.strokeColor === 'string' && COLOR.test(v.strokeColor) && intIn(v.strokeWidth, 0, 30)
    && typeof v.boxColor === 'string' && COLOR.test(v.boxColor) && intIn(v.boxOpacity, 0, 100)
    && typeof v.boxRound === 'boolean' && typeof v.shadow === 'boolean'
}
export const validFontSize = (value: number) => Number.isFinite(value) && value >= MIN_FONT_SIZE && value <= MAX_FONT_SIZE
export function validTextItem(item: TextItem): boolean {
  return validPlacement(item) && typeof item.id === 'string' && typeof item.text === 'string' && item.text.length <= MAX_TEXT_LENGTH
    && validFontSize(item.fontSize) && validTextStyle(item.style)
}
export const LINE_HEIGHT = 1.3
export interface TextLayout {
  lines: string[]
  lineHeight: number
  /** Outline thickness outside the glyphs (canvas lineWidth is twice this). */
  stroke: number
  padX: number
  padY: number
  width: number
  height: number
}
/** Box size for a text at its font size; `measure` returns the advance width of one line in the item's font. */
export function layoutText(item: Pick<TextItem, 'text' | 'fontSize' | 'style'>, measure: (line: string) => number): TextLayout {
  const size = item.fontSize, lines = item.text.split('\n')
  const lineHeight = size * LINE_HEIGHT
  const stroke = size * item.style.strokeWidth / 100
  const box = item.style.boxOpacity > 0
  const padX = box ? size * 0.4 : 0, padY = box ? size * 0.2 : 0
  const content = Math.max(size * 0.5, ...lines.map(measure))
  return { lines, lineHeight, stroke, padX, padY, width: content + 2 * (padX + stroke), height: lines.length * lineHeight + 2 * (padY + stroke) }
}
/** Horizontal anchor of the lines inside a box of `width`, relative to the box center. */
export function lineAnchor(align: TextAlign, width: number, layout: Pick<TextLayout, 'padX' | 'stroke'>): number {
  const inset = width / 2 - layout.padX - layout.stroke
  return align === 'left' ? -inset : align === 'right' ? inset : 0
}
/** A text item resized by the transform handles: the font size follows the box width. */
export function scaleText(item: TextItem, placement: Placement): TextItem {
  const ratio = placement.width / item.width
  const fontSize = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, item.fontSize * ratio))
  const applied = fontSize / item.fontSize
  return { ...item, x: placement.x, y: placement.y, rotation: placement.rotation, fontSize, width: item.width * applied, height: item.height * applied }
}
