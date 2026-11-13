import { BUNDLED_FONTS, FALLBACK_FONT, bundledFamily, bundledFont, fontFamilyList, systemFamily, validFamilyName, type FontRef } from '../shared/fonts'
import { layoutText, lineAnchor, type TextItem, type TextLayout } from '../shared/text'

const loaded = new Map<string, Promise<void>>()
/** Registers a bundled font weight once (lazy: files are only read when a text uses them). */
function loadBundled(id: string, weight: 400 | 700): Promise<void> {
  const font = bundledFont(id)
  if (!font) return Promise.resolve()
  const file = font.files[weight] ?? font.files[400]
  // Without a real bold file the regular face is registered for 400 only and the browser synthesizes bold.
  const faceWeight = font.files[weight] ? weight : 400
  const key = `${id}:${faceWeight}`
  let task = loaded.get(key)
  if (!task) {
    const face = new FontFace(bundledFamily(id), `url("./fonts/${id}/${file}")`, { weight: String(faceWeight) })
    task = face.load().then(ready => { document.fonts.add(ready) })
    task.catch(() => loaded.delete(key))
    loaded.set(key, task)
  }
  return task
}
/** Makes sure a text's font (and the fallback used for missing glyphs) is ready before it is measured or drawn. */
export async function ensureFont(ref: FontRef, bold: boolean): Promise<void> {
  const weight = bold ? 700 : 400
  const tasks = [loadBundled(FALLBACK_FONT, weight)]
  const family = systemFamily(ref)
  if (family === null) tasks.push(loadBundled(ref, weight))
  await Promise.all(tasks)
  // Installed fonts resolve by name; load() just waits until the face is available to canvas.
  if (family !== null) await document.fonts.load(fontCss(ref, bold, 16), '가A').catch(() => undefined)
}
export const ensureTextFonts = (texts: readonly TextItem[]) => Promise.all(texts.map(item => ensureFont(item.style.font, item.style.bold)))
export const fontCss = (ref: FontRef, bold: boolean, size: number) => `${bold ? 700 : 400} ${size}px ${fontFamilyList(ref)}`
/** CSS for previewing a font in the panel (the font must be loaded with ensureFont first). */
export const previewFamily = (ref: FontRef) => fontFamilyList(ref)

let measurer: OffscreenCanvasRenderingContext2D | null = null
export function measureLayout(item: Pick<TextItem, 'text' | 'fontSize' | 'style'>): TextLayout {
  measurer ??= new OffscreenCanvas(1, 1).getContext('2d')
  const context = measurer
  if (!context) throw new Error('글자 측정용 Canvas를 만들 수 없습니다.')
  context.font = fontCss(item.style.font, item.style.bold, item.fontSize)
  return layoutText(item, line => context.measureText(line).width)
}
/** The item with its box re-measured for the current text/style (center stays put). */
export function withMeasuredSize<T extends Pick<TextItem, 'text' | 'fontSize' | 'style'>>(item: T): T & { width: number; height: number } {
  const layout = measureLayout(item)
  return { ...item, width: layout.width, height: layout.height }
}

type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
const rgba = (hex: string, alpha: number) => `rgba(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}, ${alpha})`
/**
 * Draws one text item centered on the current origin (the caller translates/rotates to the item).
 * Preview (Konva) and export call this same function, so outline, box and shadow match.
 */
export function drawText(context: Context2D, item: TextItem) {
  const style = item.style, size = item.fontSize
  const layout = measureLayout(item)
  const { width, height } = item
  context.save()
  if (style.boxOpacity > 0) {
    context.fillStyle = rgba(style.boxColor, style.boxOpacity / 100)
    context.beginPath()
    context.roundRect(-width / 2, -height / 2, width, height, style.boxRound ? Math.min(size * 0.35, height / 2) : 0)
    context.fill()
  }
  context.font = fontCss(style.font, style.bold, size)
  context.textAlign = style.align
  context.textBaseline = 'middle'
  context.lineJoin = 'round'
  context.miterLimit = 2
  const x = lineAnchor(style.align, width, layout)
  const top = -height / 2 + layout.padY + layout.stroke
  const lineY = (index: number) => top + layout.lineHeight * (index + 0.5)
  if (style.shadow) {
    // Shadow values are in device pixels and ignore the transform, so scale them by it (and keep the offset "below" the text).
    const matrix = context.getTransform(), scale = Math.hypot(matrix.a, matrix.b)
    const offset = size * 0.05
    context.shadowColor = 'rgba(0, 0, 0, 0.55)'
    context.shadowBlur = size * 0.15 * scale
    context.shadowOffsetX = matrix.c * offset
    context.shadowOffsetY = matrix.d * offset
  }
  if (layout.stroke > 0) {
    context.strokeStyle = style.strokeColor
    context.lineWidth = layout.stroke * 2
    layout.lines.forEach((line, index) => context.strokeText(line, x, lineY(index)))
    // One shadow under the outline is enough; the fill on top stays crisp.
    context.shadowColor = 'transparent'
  }
  context.fillStyle = style.color
  layout.lines.forEach((line, index) => context.fillText(line, x, lineY(index)))
  context.restore()
}

let systemFonts: Promise<string[]> | null = null
/** Families installed on the PC (Local Font Access). Empty when the API or permission is unavailable. */
export function listSystemFonts(): Promise<string[]> {
  systemFonts ??= (async () => {
    const query = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts
    if (!query) return []
    const fonts = await query.call(window)
    const bundled = new Set(BUNDLED_FONTS.map(font => font.name))
    return [...new Set(fonts.map(font => font.family))].filter(family => validFamilyName(family) && !bundled.has(family) && !family.startsWith('.'))
      .sort((a, b) => a.localeCompare(b, 'ko'))
  })().catch(() => { systemFonts = null; return [] })
  return systemFonts
}
