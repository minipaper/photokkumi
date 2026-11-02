export interface LibrarySticker {
  id: string
  hash: string
  name: string
  category: string
  favorite: boolean
  originalName: string
  width: number
  height: number
}
export interface LibraryImportResult { stickers: LibrarySticker[]; importedIds: string[] }
export interface LibraryManifest { schemaVersion: 1; stickers: LibrarySticker[] }
export interface StickerMetadata { name: string; category: string; favorite: boolean }
export const MAX_STICKERS = 100
export const MAX_LIBRARY_BYTES = 256 * 1024 * 1024
export const MAX_BACKUP_BYTES = 272 * 1024 * 1024
export const MAX_MANIFEST_BYTES = 256 * 1024
export const validAssetId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
function text(value: unknown, max: number, empty = false): value is string {
  return typeof value === 'string' && value.length <= max && (empty || value.trim().length > 0)
    && ![...value].some(char => char.charCodeAt(0) < 32)
}
export function validMetadata(value: unknown): value is StickerMetadata {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return Object.keys(v).sort().join(',') === 'category,favorite,name' && text(v.name, 80) && text(v.category, 40, true) && typeof v.favorite === 'boolean'
}
export function parseManifest(value: unknown): LibraryManifest {
  if (!value || typeof value !== 'object') throw new Error('라이브러리 manifest가 손상되었습니다.')
  const manifest = value as Record<string, unknown>
  if (Object.keys(manifest).sort().join(',') !== 'schemaVersion,stickers' || manifest.schemaVersion !== 1 || !Array.isArray(manifest.stickers) || manifest.stickers.length > MAX_STICKERS) throw new Error('지원하지 않는 라이브러리 형식입니다.')
  const ids = new Set<string>(), hashes = new Set<string>()
  for (const item of manifest.stickers) {
    if (!item || typeof item !== 'object' || Object.keys(item).sort().join(',') !== 'category,favorite,hash,height,id,name,originalName,width'
      || !validAssetId(item.id) || typeof item.hash !== 'string' || !/^[0-9a-f]{64}$/.test(item.hash) || !text(item.originalName, 255)
      || !validMetadata({ name: item.name, category: item.category, favorite: item.favorite })
      || !Number.isInteger(item.width) || !Number.isInteger(item.height) || item.width < 1 || item.height < 1
      || item.width > 8192 || item.height > 8192 || item.width * item.height > 4_000_000
      || ids.has(item.id) || hashes.has(item.hash)) throw new Error('잘못된 스티커 메타데이터입니다.')
    ids.add(item.id); hashes.add(item.hash)
  }
  return structuredClone(manifest) as unknown as LibraryManifest
}
