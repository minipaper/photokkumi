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
/** Quick looks that keep the font and size; each pairs text with an outline or box so it reads on any photo. */
export const TEXT_PRESETS: readonly { name: string; style: Partial<TextStyle> }[] = [
  { name: '흰 글자 + 검은 외곽선', style: { color: '#ffffff', strokeColor: '#000000', strokeWidth: 8, boxOpacity: 0, shadow: false } },
  { name: '검은 글자 + 흰 외곽선', style: { color: '#111111', strokeColor: '#ffffff', strokeWidth: 8, boxOpacity: 0, shadow: false } },
  { name: '노란 자막', style: { color: '#ffe14d', strokeColor: '#1a1a1a', strokeWidth: 10, boxOpacity: 0, shadow: true } },
  { name: '반투명 검은 상자', style: { color: '#ffffff', strokeWidth: 0, boxColor: '#000000', boxOpacity: 55, boxRound: true, shadow: false } },
  { name: '흰 상자', style: { color: '#222222', strokeWidth: 0, boxColor: '#ffffff', boxOpacity: 90, boxRound: true, shadow: false } },
  { name: '분홍 + 흰 외곽선', style: { color: '#ff5c93', strokeColor: '#ffffff', strokeWidth: 12, boxOpacity: 0, shadow: false } },
  { name: '그림자만', style: { color: '#ffffff', strokeWidth: 0, boxOpacity: 0, shadow: true } }
]
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
