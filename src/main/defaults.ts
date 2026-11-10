import { join, normalize, isAbsolute, sep } from 'node:path'
import { validMetadata } from '../shared/library'
import { readBounded } from './library'
import type { StickerLibrary, BundledSticker } from './library'

/**
 * Default sticker pack shipped with the app (resources/default-stickers).
 * manifest.json: { pack: <positive int>, stickers: [{ file: "animal/x.png", name, category }] }.
 * The pack number is remembered in prefs so each pack is added once: stickers the user deletes stay deleted.
 */
export interface BundledPack { pack: number; stickers: BundledSticker[] }

export async function readBundledPack(root: string): Promise<BundledPack> {
  const value = JSON.parse((await readBounded(join(root, 'manifest.json'), 64 * 1024)).toString('utf8')) as Record<string, unknown>
  if (!value || !Number.isInteger(value.pack) || (value.pack as number) < 1 || !Array.isArray(value.stickers) || value.stickers.length > 100) throw new Error('기본 스티커 목록이 잘못되었습니다.')
  const stickers = value.stickers.map((item: Record<string, unknown>) => {
    const file = item?.file
    if (typeof file !== 'string' || !/^[a-z0-9-]+\/[a-z0-9-]+\.png$/.test(file) || isAbsolute(file)) throw new Error('기본 스티커 경로가 잘못되었습니다.')
    if (!validMetadata({ name: item.name, category: item.category, favorite: false })) throw new Error('기본 스티커 이름이 잘못되었습니다.')
    const path = normalize(join(root, file))
    if (!path.startsWith(normalize(root) + sep)) throw new Error('기본 스티커 경로가 잘못되었습니다.')
    return { path, name: item.name as string, category: item.category as string }
  })
  return { pack: value.pack as number, stickers }
}

/** Adds a newer pack than the one already seeded. Returns the pack number to remember, or null when nothing was attempted. */
export async function seedDefaultStickers(library: StickerLibrary, root: string | null, seeded: number): Promise<number | null> {
  if (!root) return null
  const bundle = await readBundledPack(root)
  if (bundle.pack <= seeded) return null
  await library.addBundled(bundle.stickers)
  return bundle.pack
}
