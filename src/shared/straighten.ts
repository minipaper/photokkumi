/**
 * Straightening (기울기): the photo alone tilts by a small angle inside its frame and is enlarged just enough
 * that no empty corner shows (like phone galleries). The frame keeps its size, so stickers, texts, blur regions
 * and the crop keep their coordinates. `Scene.straighten` is degrees clockwise in 0.1° steps; undefined = level.
 */
interface Size { width: number; height: number }
export const MAX_STRAIGHTEN = 45
const tenths = (value: number) => Math.round(value * 10)
export function validStraighten(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value) && value !== 0
    && Math.abs(value) <= MAX_STRAIGHTEN && Math.abs(tenths(value) / 10 - value) < 1e-9)
}
/** Rounds to 0.1° inside ±45°; 0 (level) becomes undefined so a level photo stores nothing. */
export function normalizeStraighten(value: number): number | undefined {
  if (!Number.isFinite(value)) return undefined
  const rounded = Math.max(-MAX_STRAIGHTEN * 10, Math.min(MAX_STRAIGHTEN * 10, tenths(value))) / 10
  return rounded === 0 ? undefined : rounded
}
/**
 * Enlargement that keeps the tilted photo covering its whole frame: the frame turned back by the angle
 * must fit inside the enlarged photo, i.e. its bounding box (W·cos + H·sin) × (W·sin + H·cos).
 */
export function coverScale(size: Size, degrees: number | undefined): number {
  if (!degrees) return 1
  const angle = Math.abs(degrees) * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle)
  return Math.max((size.width * cos + size.height * sin) / size.width, (size.width * sin + size.height * cos) / size.height)
}
