import { coverPlacement, cornerRadius, THUMB_SIZE, type ShapeItem, type ThumbBackground } from '../shared/shapes'
import { arrangeTexts, attachShapes, carryContents, templateBase, templateColors, templateTexts, type ThumbTemplate } from '../shared/thumb-templates'
import type { TextItem } from '../shared/text'
import { drawText, ensureTextFonts, withMeasuredSize } from './text'

type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
const rgba = (hex: string, alpha: number) => `rgba(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}, ${alpha})`
/** Draws one shape centered on the current origin (the caller translates/rotates). Preview and export share it. */
export function drawShape(context: Context2D, shape: ShapeItem) {
  const { width, height } = shape
  context.save()
  context.beginPath()
  if (shape.kind === 'ellipse') context.ellipse(0, 0, width / 2, height / 2, 0, 0, Math.PI * 2)
  else context.roundRect(-width / 2, -height / 2, width, height, cornerRadius(shape))
  if (shape.shadow) {
    // Like text shadows: canvas shadow values ignore the transform, so scale them by it.
    const matrix = context.getTransform(), scale = Math.hypot(matrix.a, matrix.b), size = Math.min(width, height)
    context.shadowColor = 'rgba(0, 0, 0, 0.28)'
    context.shadowBlur = Math.min(40, size * 0.06) * scale
    context.shadowOffsetX = matrix.c * Math.min(16, size * 0.02)
    context.shadowOffsetY = matrix.d * Math.min(16, size * 0.02)
  }
  if (shape.fillOpacity > 0) { context.fillStyle = rgba(shape.fill, shape.fillOpacity / 100); context.fill() }
  if (shape.strokeWidth > 0) {
    if (shape.fillOpacity > 0) context.shadowColor = 'transparent'
    context.strokeStyle = shape.stroke; context.lineWidth = shape.strokeWidth; context.stroke()
  }
  context.restore()
}
/** Background color, the photo cover-cropped into the square, then the dim layer. */
export function drawBackground(context: Context2D, background: ThumbBackground, photo: ImageBitmap | null, size = THUMB_SIZE) {
  context.fillStyle = background.color
  context.fillRect(0, 0, size, size)
  if (!photo || background.hidePhoto) return
  const place = coverPlacement(photo.width, photo.height, background, size)
  context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high'
  context.drawImage(photo, place.x, place.y, place.width, place.height)
  if (background.dim > 0) { context.fillStyle = `rgba(0, 0, 0, ${background.dim / 100})`; context.fillRect(0, 0, size, size) }
}
/** The background as a 1080 bitmap: the editor shows it as the "photo" and the export composes on top of it. */
export function renderBackground(background: ThumbBackground, photo: ImageBitmap | null): ImageBitmap {
  const canvas = new OffscreenCanvas(THUMB_SIZE, THUMB_SIZE)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('배경을 그릴 Canvas를 만들 수 없습니다.')
  drawBackground(context, background, photo)
  return canvas.transferToImageBitmap()
}
let placeholder: ImageBitmap | null = null
/** A made-up landscape that stands in for the photo in template previews until the user picks one. */
export function placeholderPhoto(): ImageBitmap {
  if (placeholder) return placeholder
  const size = 540, canvas = new OffscreenCanvas(size, size), context = canvas.getContext('2d')!
  const sky = context.createLinearGradient(0, 0, 0, size)
  sky.addColorStop(0, '#f3b27a'); sky.addColorStop(0.55, '#c98a9a'); sky.addColorStop(1, '#5c6f9e')
  context.fillStyle = sky; context.fillRect(0, 0, size, size)
  context.fillStyle = '#ffe6b0'; context.beginPath(); context.arc(380, 190, 60, 0, Math.PI * 2); context.fill()
  context.fillStyle = '#4b5b7c'; context.beginPath(); context.moveTo(0, 400); context.quadraticCurveTo(160, 300, 300, 380); context.quadraticCurveTo(430, 450, 540, 360); context.lineTo(540, 540); context.lineTo(0, 540); context.fill()
  context.fillStyle = '#34405a'; context.beginPath(); context.moveTo(0, 470); context.quadraticCurveTo(260, 400, 540, 480); context.lineTo(540, 540); context.lineTo(0, 540); context.fill()
  placeholder = canvas.transferToImageBitmap()
  return placeholder
}
export interface ThumbLayout { background: ThumbBackground; shapes: ShapeItem[]; texts: TextItem[]; template?: string }
/**
 * A template laid out with measured texts. Texts of the same slot keep the current content,
 * the photo choice and its crop stay, and the colors follow the chosen theme (or the template's own).
 */
export async function layoutTemplate(template: ThumbTemplate, theme: string | undefined, keep: Pick<ThumbBackground, 'photoId' | 'zoom' | 'focusX' | 'focusY'>, currentTexts: readonly TextItem[], newId: () => string = () => crypto.randomUUID()): Promise<ThumbLayout> {
  const colors = templateColors(template, theme)
  const base = templateBase(template, colors, keep, newId)
  const specs = templateTexts(template, colors, carryContents(currentTexts, template), newId)
  await ensureTextFonts(specs.map(spec => ({ style: spec.item.style }) as TextItem))
  // Text wider than its area (a long carried-over title) shrinks to fit.
  const measured = specs.map(({ item, anchor }) => {
    const first = withMeasuredSize(item)
    if (first.width <= anchor.max) return first
    return withMeasuredSize({ ...item, fontSize: Math.max(16, Math.floor(item.fontSize * anchor.max / first.width)) })
  })
  const centers = arrangeTexts(specs.map(({ anchor }, index) => ({ anchor, width: measured[index].width, height: measured[index].height })))
  const texts = measured.map((item, index) => ({ ...item, ...centers[index] }) as TextItem)
  const shapes = attachShapes(template, base.shapes, new Map(texts.map(item => [item.slot!, item])))
  return { background: base.background, shapes, texts, template: template.id }
}
/** Draws a laid-out thumbnail at `size` px (template list previews and "내 템플릿" pictures). */
export function drawLayout(context: Context2D, layout: ThumbLayout, photo: ImageBitmap | null, size: number) {
  const scale = size / THUMB_SIZE
  context.save()
  context.scale(scale, scale)
  drawBackground(context, layout.background, photo)
  for (const item of [...layout.shapes, ...layout.texts]) {
    context.save()
    context.translate(item.x, item.y); context.rotate(item.rotation * Math.PI / 180)
    if ('kind' in item) drawShape(context, item); else drawText(context, item)
    context.restore()
  }
  context.restore()
}
