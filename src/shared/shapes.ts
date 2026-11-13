import { validPlacement, type Placement } from './model'
/** Boxes, cards, frames and circles under stickers and texts. (x, y) is the center in logical pixels, rotation in degrees. */
export type ShapeKind = 'rect' | 'ellipse'
export interface ShapeItem extends Placement {
  id: string
  kind: ShapeKind
  fill: string
  /** 0 = no fill (a frame when the stroke is on). */
  fillOpacity: number
  stroke: string
  /** Outline width in logical pixels, drawn centered on the edge; 0 = none. */
  strokeWidth: number
  /** Corner radius in % of the shorter side (rect only); 50 = pill. */
  radius: number
  shadow: boolean
  /** Colors that follow the color theme (set by templates; a manual color change drops the link). */
  themed?: Partial<Record<'fill' | 'stroke', ThemeSlot>>
}
export const MAX_SHAPES = 50
const COLOR = /^#[0-9a-f]{6}$/i
/** Theme colors: accent (main color), onAccent (text/marks drawn on the accent), soft (pale background). */
export type ThemeSlot = 'accent' | 'onAccent' | 'soft'
export const THEME_SLOTS: readonly ThemeSlot[] = ['accent', 'onAccent', 'soft']
export interface Palette { id: string; name: string; accent: string; onAccent: string; soft: string }
export const PALETTES: readonly Palette[] = [
  { id: 'yellow', name: '노랑', accent: '#ffd43b', onAccent: '#1f1f1f', soft: '#fff3c4' },
  { id: 'orange', name: '주황', accent: '#ff8a3d', onAccent: '#ffffff', soft: '#ffe4d1' },
  { id: 'pink', name: '분홍', accent: '#ff6fa5', onAccent: '#ffffff', soft: '#ffe1ed' },
  { id: 'red', name: '빨강', accent: '#e63946', onAccent: '#ffffff', soft: '#ffdcdf' },
  { id: 'green', name: '초록', accent: '#1fae74', onAccent: '#ffffff', soft: '#d9f3e7' },
  { id: 'mint', name: '민트', accent: '#3cc8b4', onAccent: '#ffffff', soft: '#d8f5f0' },
  { id: 'sky', name: '하늘', accent: '#3fa9f5', onAccent: '#ffffff', soft: '#dcefff' },
  { id: 'blue', name: '파랑', accent: '#3d5afe', onAccent: '#ffffff', soft: '#dfe4ff' },
  { id: 'purple', name: '보라', accent: '#8e6cef', onAccent: '#ffffff', soft: '#ebe4ff' },
  { id: 'brown', name: '갈색', accent: '#b5835a', onAccent: '#ffffff', soft: '#f3e7da' }
]
export const palette = (id: string | null | undefined) => PALETTES.find(item => item.id === id)
/** undefined, or an object mapping some of `keys` to theme slots. */
export function validThemed(value: unknown, keys: readonly string[]): boolean {
  if (value === undefined) return true
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.entries(value).every(([key, slot]) => keys.includes(key) && THEME_SLOTS.includes(slot as ThemeSlot))
}
const intIn = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
export function validShapeStyle(value: unknown): value is Omit<ShapeItem, keyof Placement | 'id'> {
  const v = value as Record<string, unknown> | null
  return !!v && typeof v === 'object' && (v.kind === 'rect' || v.kind === 'ellipse')
    && typeof v.fill === 'string' && COLOR.test(v.fill) && intIn(v.fillOpacity, 0, 100)
    && typeof v.stroke === 'string' && COLOR.test(v.stroke) && intIn(v.strokeWidth, 0, 200)
    && intIn(v.radius, 0, 50) && typeof v.shadow === 'boolean' && validThemed(v.themed, ['fill', 'stroke'])
}
export function validShapeItem(item: ShapeItem): boolean {
  return validPlacement(item) && typeof item.id === 'string' && item.id.length <= 64 && validShapeStyle(item)
}
export const SHAPE_STYLE_KEYS = ['kind', 'fill', 'fillOpacity', 'stroke', 'strokeWidth', 'radius', 'shadow'] as const
export type ShapeStyle = Pick<ShapeItem, typeof SHAPE_STYLE_KEYS[number]>
/** Corner radius in logical pixels for a rect of this size. */
export const cornerRadius = (shape: Pick<ShapeItem, 'width' | 'height' | 'radius'>) => Math.min(shape.width, shape.height) * shape.radius / 100

/** Thumbnail background: a solid color, optionally covered by a photo cropped to the square and darkened. */
export interface ThumbBackground {
  color: string
  /** Photo from the photo list drawn over the color, or null. */
  photoId: string | null
  /** 100 = the photo just covers the square; up to 400. */
  zoom: number
  /** Which part of the photo stays in view when it is larger than the square, 0~100 %. */
  focusX: number
  focusY: number
  /** Black overlay over the photo, 0~90 %. */
  dim: number
  /** The color follows the color theme. */
  colorSlot?: ThemeSlot
  /** Card-news templates keep the chosen photo for later template swaps but do not show it. */
  hidePhoto?: true
}
export const THUMB_SIZE = 1080
/** Session/reference id of the thumbnail being made (photo ids are UUIDs, so it never collides). */
export const THUMB_SESSION_ID = 'thumbnail'
export interface ThumbSaveRequest { photoId: string | null; png: Uint8Array; format: 'png' | 'jpg' }
export function validThumbSaveRequest(value: unknown): value is ThumbSaveRequest {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return Object.keys(v).length === 3 && (v.photoId === null || (typeof v.photoId === 'string' && v.photoId.length === 36))
    && v.png instanceof Uint8Array && (v.format === 'png' || v.format === 'jpg')
}
export const DEFAULT_BACKGROUND: ThumbBackground = { color: '#2b2f38', photoId: null, zoom: 100, focusX: 50, focusY: 50, dim: 40 }
export function validBackground(value: unknown): value is ThumbBackground {
  const v = value as Record<string, unknown> | null
  return !!v && typeof v === 'object' && typeof v.color === 'string' && COLOR.test(v.color)
    && (v.photoId === null || (typeof v.photoId === 'string' && v.photoId.length === 36))
    && intIn(v.zoom, 100, 400) && intIn(v.focusX, 0, 100) && intIn(v.focusY, 0, 100) && intIn(v.dim, 0, 90)
    && (v.colorSlot === undefined || THEME_SLOTS.includes(v.colorSlot as ThemeSlot))
    && (v.hidePhoto === undefined || v.hidePhoto === true)
}
/** Where a cover-cropped photo lands in the square: scale and top-left offset (logical pixels). */
export function coverPlacement(photoWidth: number, photoHeight: number, background: Pick<ThumbBackground, 'zoom' | 'focusX' | 'focusY'>, size = THUMB_SIZE) {
  const scale = Math.max(size / photoWidth, size / photoHeight) * background.zoom / 100
  const width = photoWidth * scale, height = photoHeight * scale
  return { scale, x: (size - width) * background.focusX / 100, y: (size - height) * background.focusY / 100, width, height }
}
