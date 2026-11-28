/**
 * 사진 합치기 (collage): pure layout math shared by the preview, the full-size render and the tests.
 * All lengths are output pixels; the preview draws the same plan scaled down.
 */
export type CollageLayoutId = 'pair-h' | 'pair-v' | 'trio-big' | 'trio-h' | 'grid-4' | 'stack'
/** One row of a grid layout: `cols` equal cells whose height is `aspect` × their width. */
interface RowSpec { cols: number; aspect: number }
export interface CollageLayout { id: CollageLayoutId; name: string; rows: readonly RowSpec[] | null }
export const COLLAGE_LAYOUTS: readonly CollageLayout[] = [
  // Side by side photos are portrait 3:4 cells; stacked ones landscape 4:3; the big + two layout uses 3:2 cells everywhere.
  { id: 'pair-h', name: '2장 가로', rows: [{ cols: 2, aspect: 4 / 3 }] },
  { id: 'pair-v', name: '2장 세로', rows: [{ cols: 1, aspect: 3 / 4 }, { cols: 1, aspect: 3 / 4 }] },
  { id: 'trio-big', name: '3장 (큰 1 + 작은 2)', rows: [{ cols: 1, aspect: 2 / 3 }, { cols: 2, aspect: 2 / 3 }] },
  { id: 'trio-h', name: '3장 가로', rows: [{ cols: 3, aspect: 4 / 3 }] },
  { id: 'grid-4', name: '4장 2×2', rows: [{ cols: 2, aspect: 1 }, { cols: 2, aspect: 1 }] },
  // Each photo keeps its own aspect ratio at the output width (a blog "long image").
  { id: 'stack', name: '세로 이어붙이기', rows: null }
]
export const layoutById = (id: CollageLayoutId) => COLLAGE_LAYOUTS.find(item => item.id === id)!
export const STACK_MIN = 2, STACK_MAX = 10
export const COLLAGE_WIDTHS = [1080, 1600, 2000] as const
export type CollageWidth = typeof COLLAGE_WIDTHS[number]
export const MAX_GAP = 40, MAX_RADIUS = 40, MAX_ZOOM = 4
/** Same ceilings as every other saved image (src/main/images.ts, shared/output.ts). */
export const COLLAGE_MAX_PIXELS = 16_000_000, COLLAGE_MAX_SIDE = 8192
/** Below this the stacked photos are too long to fit the limits at a useful width. */
export const COLLAGE_MIN_WIDTH = 200
export const COLLAGE_JPEG_QUALITY = 90
export const COLLAGE_BACKGROUNDS = [
  { color: '#ffffff', name: '흰색' }, { color: '#000000', name: '검정' }, { color: '#f2f3f5', name: '연한 회색' },
  { color: '#f6efe3', name: '베이지' }, { color: '#fde7ec', name: '연분홍' }, { color: '#e5f1fb', name: '하늘' }
] as const
export interface CollageOptions {
  layout: CollageLayoutId
  width: CollageWidth
  /** Space between photos; with `margin` the same space also goes around the outside. */
  gap: number
  margin: boolean
  background: string
  /** Corner radius of each photo. */
  radius: number
  format: 'jpg' | 'png'
}
export const DEFAULT_COLLAGE: CollageOptions = { layout: 'grid-4', width: 1080, gap: 10, margin: true, background: '#ffffff', radius: 0, format: 'jpg' }
const COLOR = /^#[0-9a-f]{6}$/i
const intIn = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
export function validCollageOptions(value: unknown): value is CollageOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  return Object.keys(v).length === 7 && COLLAGE_LAYOUTS.some(item => item.id === v.layout) && COLLAGE_WIDTHS.includes(v.width as CollageWidth)
    && intIn(v.gap, 0, MAX_GAP) && typeof v.margin === 'boolean' && typeof v.background === 'string' && COLOR.test(v.background)
    && intIn(v.radius, 0, MAX_RADIUS) && (v.format === 'jpg' || v.format === 'png')
}

export interface Size { width: number; height: number }
export interface Rect extends Size { x: number; y: number }
export interface CollagePlan extends Size {
  cells: Rect[]
  gap: number
  margin: number
  radius: number
  /** Output width ÷ requested width: below 1 when a long stack had to shrink to stay inside the pixel limits. */
  scale: number
}
/** Number of photo cells; a stack has as many as it holds (2–10). */
export function cellCount(layout: CollageLayoutId, stackCount = STACK_MIN): number {
  const rows = layoutById(layout).rows
  return rows ? rows.reduce((sum, row) => sum + row.cols, 0) : Math.min(STACK_MAX, Math.max(STACK_MIN, stackCount))
}
/** Splits `length` into `count` whole-pixel parts with `gap` between them; parts differ by at most one pixel. */
function split(length: number, count: number, gap: number) {
  const inner = length - gap * (count - 1)
  const edges = Array.from({ length: count + 1 }, (_, index) => Math.round(inner * index / count))
  return edges.slice(0, -1).map((edge, index) => ({ start: edge + gap * index, size: edges[index + 1] - edge }))
}
function planAt(layout: CollageLayout, width: number, gap: number, margin: number, radius: number, photos: readonly Size[]) {
  const inner = width - margin * 2
  if (inner < 1) throw new Error('여백이 너무 큽니다.')
  const cells: Rect[] = []
  let y = margin
  if (layout.rows) {
    layout.rows.forEach((row, index) => {
      if (index) y += gap
      const parts = split(inner, row.cols, gap)
      const height = Math.max(1, Math.round((inner - gap * (row.cols - 1)) / row.cols * row.aspect))
      for (const part of parts) cells.push({ x: margin + part.start, y, width: part.size, height })
      y += height
    })
  } else {
    photos.forEach((photo, index) => {
      if (index) y += gap
      const height = Math.max(1, Math.round(inner * photo.height / photo.width))
      cells.push({ x: margin, y, width: inner, height })
      y += height
    })
  }
  return { width, height: y + margin, cells, gap, margin, radius }
}
const fits = (size: Size) => size.width <= COLLAGE_MAX_SIDE && size.height <= COLLAGE_MAX_SIDE && size.width * size.height <= COLLAGE_MAX_PIXELS
/**
 * Cell rectangles for the options. `photos` are the (edited) photo sizes of a stack, in order; grid layouts ignore them.
 * A stack taller than the limits is shrunk as a whole (width, gap and radius together) until it fits.
 */
export function planCollage(options: Pick<CollageOptions, 'layout' | 'gap' | 'margin' | 'radius'> & { width: number }, photos: readonly Size[] = []): CollagePlan {
  const layout = layoutById(options.layout)
  if (!layout.rows && (photos.length < STACK_MIN || photos.length > STACK_MAX)) throw new Error(`세로 이어붙이기는 사진 ${STACK_MIN}~${STACK_MAX}장입니다.`)
  if (photos.some(photo => !(photo.width > 0 && photo.height > 0 && Number.isFinite(photo.width) && Number.isFinite(photo.height)))) throw new Error('사진 크기를 확인할 수 없습니다.')
  const at = (width: number) => {
    const ratio = width / options.width
    const gap = Math.round(options.gap * ratio)
    return planAt(layout, width, gap, options.margin ? gap : 0, Math.round(options.radius * ratio), photos)
  }
  let plan = at(options.width)
  for (let attempt = 0; attempt < 30 && !fits(plan); attempt++) {
    const factor = Math.min(COLLAGE_MAX_SIDE / plan.height, COLLAGE_MAX_SIDE / plan.width, Math.sqrt(COLLAGE_MAX_PIXELS / (plan.width * plan.height)))
    const width = Math.min(plan.width - 1, Math.floor(plan.width * factor))
    if (width < COLLAGE_MIN_WIDTH) break
    plan = at(width)
  }
  if (!fits(plan) || plan.width < COLLAGE_MIN_WIDTH) throw new Error('사진이 너무 길어 1,600만 픽셀·한 변 8,192px 안에 이어 붙일 수 없습니다. 사진 수를 줄이세요.')
  return { ...plan, scale: plan.width / options.width }
}

/** How a photo sits in its cell: `zoom` 1 = just covers the cell; `x`/`y` 0–1 pick which part shows (0.5 = centre). */
export interface CellView { zoom: number; x: number; y: number }
export const DEFAULT_VIEW: CellView = { zoom: 1, x: 0.5, y: 0.5 }
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))
const coverScale = (source: Size, cell: Size, zoom: number) => Math.max(cell.width / source.width, cell.height / source.height) * clamp(zoom, 1, MAX_ZOOM)
/** Part of the source photo (source pixels) drawn into the cell so it fills it without bars. */
export function coverSource(source: Size, cell: Size, view: CellView): Rect {
  const scale = coverScale(source, cell, view.zoom)
  const width = Math.min(source.width, cell.width / scale), height = Math.min(source.height, cell.height / scale)
  return { x: (source.width - width) * clamp(view.x, 0, 1), y: (source.height - height) * clamp(view.y, 0, 1), width, height }
}
/** Dragging the photo by (dx, dy) output pixels moves it with the pointer, never past its edges. */
export function panView(view: CellView, source: Size, cell: Size, dx: number, dy: number): CellView {
  const scale = coverScale(source, cell, view.zoom)
  const spareX = source.width * scale - cell.width, spareY = source.height * scale - cell.height
  return { zoom: clamp(view.zoom, 1, MAX_ZOOM), x: spareX > 0.5 ? clamp(view.x - dx / spareX, 0, 1) : 0.5, y: spareY > 0.5 ? clamp(view.y - dy / spareY, 0, 1) : 0.5 }
}
export const zoomView = (view: CellView, zoom: number): CellView => ({ ...view, zoom: clamp(zoom, 1, MAX_ZOOM) })

export interface CollageCell { photoId: string | null; view: CellView }
const emptyCell = (): CollageCell => ({ photoId: null, view: { ...DEFAULT_VIEW } })
/**
 * Cells for a layout: photos already placed keep their place (extra ones drop off the end), photos that left the list
 * are cleared, and empty cells take the photos not used yet, in list order. A new stack holds every photo up to 10.
 */
export function arrangeCells(cells: readonly CollageCell[], layout: CollageLayoutId, photoIds: readonly string[]): CollageCell[] {
  const kept = cells.map(cell => cell.photoId && photoIds.includes(cell.photoId) ? cell : emptyCell())
  const filled = kept.filter(cell => cell.photoId).length
  const count = layoutById(layout).rows ? cellCount(layout) : cellCount(layout, filled || photoIds.length)
  const next = Array.from({ length: count }, (_, index) => kept[index] ?? emptyCell())
  const unused = photoIds.filter(id => !next.some(cell => cell.photoId === id))
  return next.map(cell => cell.photoId ? cell : unused.length ? { photoId: unused.shift()!, view: { ...DEFAULT_VIEW } } : cell)
}
/**
 * A photo clicked in the strip: it goes into the selected cell, else the first empty one, else (stack) a new cell at the end.
 * Returns null when there is no place for it (grid full and no cell selected).
 */
export function placePhoto(cells: readonly CollageCell[], layout: CollageLayoutId, selected: number | null, photoId: string): { cells: CollageCell[]; index: number } | null {
  let index = selected !== null && selected >= 0 && selected < cells.length ? selected : cells.findIndex(cell => !cell.photoId)
  const next = [...cells]
  if (index < 0) {
    if (layoutById(layout).rows || cells.length >= STACK_MAX) return null
    index = next.push(emptyCell()) - 1
  }
  next[index] = { photoId, view: { ...DEFAULT_VIEW } }
  return { cells: next, index }
}
export function swapCells(cells: readonly CollageCell[], a: number, b: number): CollageCell[] {
  if (a === b || !cells[a] || !cells[b]) return [...cells]
  const next = [...cells];
  [next[a], next[b]] = [next[b], next[a]]
  return next
}
/** Empties a cell; in a stack with more than two photos the cell itself goes away. */
export function removeCell(cells: readonly CollageCell[], layout: CollageLayoutId, index: number): CollageCell[] {
  if (!cells[index]) return [...cells]
  if (!layoutById(layout).rows && cells.length > STACK_MIN) return cells.filter((_, at) => at !== index)
  return cells.map((cell, at) => at === index ? emptyCell() : cell)
}
export const updateView = (cells: readonly CollageCell[], index: number, view: CellView) => cells.map((cell, at) => at === index ? { ...cell, view } : cell)

export interface CollageSaveRequest { photoId: string; png: Uint8Array; format: 'jpg' | 'png'; width: number; height: number }
/** Shape check for the collage:save IPC; main still decodes the PNG and compares its real size. */
export function validCollageSaveRequest(value: unknown): value is CollageSaveRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  return Object.keys(v).length === 5 && typeof v.photoId === 'string' && v.photoId.length === 36 && v.png instanceof Uint8Array
    && (v.format === 'jpg' || v.format === 'png') && intIn(v.width, 1, COLLAGE_MAX_SIDE) && intIn(v.height, 1, COLLAGE_MAX_SIDE)
    && (v.width as number) * (v.height as number) <= COLLAGE_MAX_PIXELS
}
