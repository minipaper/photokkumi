import { afterEach, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { PNG } from 'pngjs'
import { StickerLibrary } from '../src/main/library'
import { readBundledPack, seedDefaultStickers } from '../src/main/defaults'

const folders: string[] = []
afterEach(async () => { await Promise.all(folders.splice(0).map(path => fs.rm(path, { recursive: true, force: true }))) })
const normalize = (bytes: Uint8Array) => PNG.sync.write(PNG.sync.read(Buffer.from(bytes)))
const png = (shade: number) => { const p = new PNG({ width: 4, height: 4 }); p.data.fill(shade); return PNG.sync.write(p) }

async function pack(count: number, number = 1) {
  const root = await fs.mkdtemp(join(tmpdir(), 'kkumi-defaults-')); folders.push(root)
  await fs.mkdir(join(root, 'bundle', 'animal'), { recursive: true })
  const stickers = []
  for (let i = 0; i < count; i++) {
    await fs.writeFile(join(root, 'bundle', 'animal', `a-${i}.png`), png(10 + i))
    stickers.push({ file: `animal/a-${i}.png`, name: `동물 ${i}`, category: 'animal' })
  }
  await fs.writeFile(join(root, 'bundle', 'manifest.json'), JSON.stringify({ pack: number, stickers }))
  const library = new StickerLibrary(join(root, 'profile'), normalize); await library.load()
  return { root, bundle: join(root, 'bundle'), library }
}

it('새 팩은 한 번만 추가하고, 이미 추가한 팩 번호면 지운 스티커를 되살리지 않는다', async () => {
  const { bundle, library } = await pack(3)
  expect(await seedDefaultStickers(library, bundle, 0)).toBe(1)
  expect(library.list().map(item => [item.name, item.category, item.originalName])).toEqual([['동물 0', 'animal', 'a-0.png'], ['동물 1', 'animal', 'a-1.png'], ['동물 2', 'animal', 'a-2.png']])
  await library.remove(library.list()[0].id, null)
  expect(await seedDefaultStickers(library, bundle, 1)).toBeNull()
  expect(library.list()).toHaveLength(2)
  expect(await seedDefaultStickers(library, null, 0)).toBeNull()
})

it('이미 같은 그림이 있으면 건너뛰고, 라이브러리 한도를 넘기지 않는다', async () => {
  const { root, bundle, library } = await pack(5)
  await fs.writeFile(join(root, 'mine.png'), png(10))
  await library.importFiles([join(root, 'mine.png')])
  await library.addBundled((await readBundledPack(bundle)).stickers)
  expect(library.list().map(item => item.name)).toEqual(['mine', '동물 1', '동물 2', '동물 3', '동물 4'])

  const full = await pack(3)
  const own = []
  for (let i = 0; i < 99; i++) { const path = join(full.root, `own-${i}.png`); await fs.writeFile(path, png(100 + i)); own.push(path) }
  await full.library.importFiles(own)
  await full.library.addBundled((await readBundledPack(full.bundle)).stickers)
  expect(full.library.list()).toHaveLength(100)
})

it('경로 밖을 가리키거나 형식이 틀린 목록은 거부한다', async () => {
  const { bundle } = await pack(1)
  for (const stickers of [[{ file: '../x.png', name: 'x', category: '' }], [{ file: 'animal/a.svg', name: 'x', category: '' }], [{ file: 'animal/a-0.png', name: '', category: '' }]]) {
    await fs.writeFile(join(bundle, 'manifest.json'), JSON.stringify({ pack: 1, stickers }))
    await expect(readBundledPack(bundle)).rejects.toThrow()
  }
})

it('앱에 들어가는 기본 동물 스티커 목록이 실제 파일과 맞다', async () => {
  const bundle = resolve('resources/default-stickers')
  const { pack: number, stickers } = await readBundledPack(bundle)
  expect(number).toBeGreaterThanOrEqual(1)
  expect(stickers).toHaveLength(28)
  expect(new Set(stickers.map(item => item.category))).toEqual(new Set(['animal']))
  const files = (await fs.readdir(join(bundle, 'animal'))).sort()
  expect(stickers.map(item => item.path.split(/[\\/]/).pop()).sort()).toEqual(files)
})
