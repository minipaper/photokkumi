import { coverSource, type CellView, type CollageCell, type CollagePlan, type Rect, type Size } from '../shared/collage'
import { encodePng } from './export'
/** A photo for a cell: `width`/`height` are the edited photo's real size; `bitmap` may be a smaller preview copy of it. */
export interface CollageSource extends Size { bitmap: ImageBitmap }
type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export function cellPath(context: Context, cell: Rect, radius: number) {
  context.beginPath()
  if (radius > 0) context.roundRect(cell.x, cell.y, cell.width, cell.height, Math.min(radius, cell.width / 2, cell.height / 2))
  else context.rect(cell.x, cell.y, cell.width, cell.height)
}
/** Draws the photo into its cell, covering it; the preview and the saved file both use this in output pixels. */
export function drawCell(context: Context, cell: Rect, source: CollageSource, view: CellView, radius: number) {
  const part = coverSource(source, cell, view)
  const sx = source.bitmap.width / source.width, sy = source.bitmap.height / source.height
  context.save()
  cellPath(context, cell, radius); context.clip()
  context.drawImage(source.bitmap, part.x * sx, part.y * sy, part.width * sx, part.height * sy, cell.x, cell.y, cell.width, cell.height)
  context.restore()
}
/**
 * The collage at full output size from full-size edited photos, loaded one at a time (each is closed right after drawing)
 * so at most one big photo and the output canvas are in memory. Returns PNG bytes; main re-encodes to the chosen format.
 */
export async function renderCollage(plan: CollagePlan, background: string, cells: readonly CollageCell[], load: (photoId: string) => Promise<CollageSource>): Promise<Uint8Array> {
  if (cells.length !== plan.cells.length || cells.some(cell => !cell.photoId)) throw new Error('빈 칸에 사진을 넣은 뒤 저장하세요.')
  const canvas = new OffscreenCanvas(plan.width, plan.height)
  try {
    const context = canvas.getContext('2d')
    if (!context) throw new Error('합성용 Canvas를 만들 수 없습니다.')
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.fillStyle = background
    context.fillRect(0, 0, plan.width, plan.height)
    for (const [index, cell] of cells.entries()) {
      const source = await load(cell.photoId!)
      try { drawCell(context, plan.cells[index], source, cell.view, plan.radius) } finally { source.bitmap.close() }
    }
    return await encodePng(canvas.transferToImageBitmap())
  } finally { canvas.width = 0; canvas.height = 0 }
}
