/**
 * Turning a photo by 90°. `Scene.turn` counts quarter turns clockwise (undefined = upright) on top of the EXIF-rotated original.
 * Everything placed on the photo (stickers, texts, blur regions, the crop) lives in the turned frame,
 * so a turn moves those coordinates with the photo: nothing on it drifts or changes size.
 */
import type { Placement } from './model'
import { hasOrientation, isPortraitAspect, orient, type Crop } from './crop'
import type { Scene } from './scene'
export type Turn = 1 | 2 | 3
interface Size { width: number; height: number }
export const validTurn = (value: unknown): value is Turn | undefined => value === undefined || value === 1 || value === 2 || value === 3
/** The photo frame after the turn: width and height swap on 90° and 270°. */
export function turnedSize(size: Size, turn: Turn | undefined): Size {
  return turn === 1 || turn === 3 ? { width: size.height, height: size.width } : { width: size.width, height: size.height }
}
/** Degrees kept in [-180, 180) so repeated turns do not grow the stored angle. */
const wrap = (degrees: number) => ((degrees + 180) % 360 + 360) % 360 - 180
/** `frame` is the size before this turn (already turned by the scene's current turn). */
function turnPlacement<T extends Placement>(item: T, frame: Size, clockwise: boolean): T {
  const x = clockwise ? frame.height - item.y : item.y, y = clockwise ? item.x : frame.width - item.x
  return { ...item, x, y, rotation: wrap(item.rotation + (clockwise ? 90 : -90)) }
}
function turnCrop(crop: Crop, frame: Size, clockwise: boolean): Crop {
  const x = clockwise ? frame.height - (crop.y + crop.height) : crop.y, y = clockwise ? crop.x : frame.width - (crop.x + crop.width)
  const aspect = hasOrientation(crop.aspect) ? orient(crop.aspect, !isPortraitAspect(crop.aspect)) : crop.aspect
  return { x, y, width: crop.height, height: crop.width, aspect }
}
/** Turns the photo a quarter turn; `frame` is the photo size as currently shown (turned). */
export function turnScene(scene: Scene, frame: Size, clockwise: boolean): Scene {
  const turn = (((scene.turn ?? 0) + (clockwise ? 1 : 3)) % 4) as 0 | Turn
  const next: Scene = {
    ...scene,
    stickers: scene.stickers.map(item => turnPlacement(item, frame, clockwise)),
    regions: scene.regions.map(item => turnPlacement(item, frame, clockwise)),
    shapes: scene.shapes.map(item => turnPlacement(item, frame, clockwise)),
    texts: scene.texts.map(item => turnPlacement(item, frame, clockwise)),
    crop: scene.crop && turnCrop(scene.crop, frame, clockwise),
    turn: turn || undefined
  }
  if (!next.turn) delete next.turn
  if (!next.crop) delete next.crop
  return next
}
