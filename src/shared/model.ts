export type AssetKind = 'photo' | 'sticker'
export interface ImageAsset {
  id: string
  name: string
  width: number
  height: number
  mime: 'image/png' | 'image/jpeg'
  bytes: Uint8Array
}
export interface Placement {
  x: number
  y: number
  width: number
  height: number
  rotation: number
}
export interface StickerInstance extends Placement { assetId: string; zOrder: 0 }
export type Result<T> = { ok: true; value: T } | { ok: false; error: string }
export interface SaveRequest { photoId: string; png: Uint8Array }
export interface CloseResolution { requestId: string; action: 'close' | 'cancel' }
export interface PhotoApi {
  onCloseRequested(callback: (requestId: string) => void): () => void
  resolveClose(request: CloseResolution): Promise<Result<null>>
  choosePhoto(): Promise<Result<ImageAsset | null>>
  chooseSticker(): Promise<Result<ImageAsset | null>>
  savePng(request: SaveRequest): Promise<Result<string | null>>
}
export function fitScale(width: number, height: number, availableWidth: number, availableHeight: number): number {
  return Math.min(1, Math.max(1, availableWidth) / width, Math.max(1, availableHeight) / height)
}
export function validPlacement(value: Placement): boolean {
  return [value.x, value.y, value.width, value.height, value.rotation].every(Number.isFinite)
    && value.width > 0 && value.height > 0 && value.width <= 32768 && value.height <= 32768
    && Math.abs(value.x) <= 65536 && Math.abs(value.y) <= 65536 && Math.abs(value.rotation) <= 36000
}
