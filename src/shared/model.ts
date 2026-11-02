import type { OutputSettings } from './output'
import type { LibrarySticker, StickerMetadata, LibraryImportResult } from './library'
export type AssetKind = 'photo' | 'sticker'
export interface ImageAsset {
  id: string
  name: string
  width: number
  height: number
  mime: 'image/png' | 'image/jpeg'
  bytes: Uint8Array
}
export interface PhotoInfo extends Omit<ImageAsset, 'bytes'> { thumbnail: string }
export interface Placement {
  x: number
  y: number
  width: number
  height: number
  rotation: number
}
export interface StickerInstance extends Placement { id: string; assetId: string; zOrder: number }
export type Result<T> = { ok: true; value: T } | { ok: false; error: string }
export interface PhotoBatch { photos: PhotoInfo[]; rejected: string[] }
export interface SaveReceipt { name: string; folderLabel: string }
export interface SaveRequest { photoId: string; png: Uint8Array; output: OutputSettings }
export interface CloseResolution { requestId: string; action: 'close' | 'cancel' }
export interface PhotoApi {
  onCloseRequested(callback: (requestId: string) => void): () => void
  resolveClose(request: CloseResolution): Promise<Result<null>>
  listStickers(): Promise<Result<LibrarySticker[]>>
  importStickers(): Promise<Result<LibraryImportResult | null>>
  setStickerReferences(photoId: string, assetIds: string[]): Promise<Result<null>>
  useSticker(id: string): Promise<Result<ImageAsset>>
  updateSticker(id: string, metadata: StickerMetadata): Promise<Result<LibrarySticker[]>>
  deleteSticker(id: string): Promise<Result<LibrarySticker[]>>
  backupLibrary(): Promise<Result<string | null>>
  restoreLibrary(): Promise<Result<LibrarySticker[] | null>>
  choosePhotos(): Promise<Result<PhotoInfo[] | null>>
  readPhoto(id: string): Promise<Result<ImageAsset>>
  choosePhotoFolder(): Promise<Result<PhotoBatch | null>>
  chooseOutputFolder(): Promise<Result<string | null>>
  getOutputSettings(): Promise<Result<OutputSettings>>
  updateOutputSettings(output: OutputSettings): Promise<Result<OutputSettings>>
  saveImage(request: SaveRequest): Promise<Result<SaveReceipt | null>>
}
export function fitScale(width: number, height: number, availableWidth: number, availableHeight: number): number {
  return Math.min(1, Math.max(1, availableWidth) / width, Math.max(1, availableHeight) / height)
}
export function validPlacement(value: Placement): boolean {
  return [value.x, value.y, value.width, value.height, value.rotation].every(Number.isFinite)
    && value.width > 0 && value.height > 0 && value.width <= 32768 && value.height <= 32768
    && Math.abs(value.x) <= 65536 && Math.abs(value.y) <= 65536 && Math.abs(value.rotation) <= 36000
}
