import { it, expect } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { PhotoStore, validDroppedPaths } from '../src/main/photos'

it('사진 ID·중복·등록 원자성·원본 변경·개수 한도를 검증한다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'photokkumi-photos-'))
  try {
    const path = join(dir, 'photo.png'), bad = join(dir, 'bad.png')
    const png = new PNG({ width: 40, height: 20 })
    const bytes = PNG.sync.write(png)
    await writeFile(path, bytes); await writeFile(bad, 'bad')
    const store = new PhotoStore(() => 'data:image/png;base64,thumb')
    const first = await store.add([path, path])
    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({ width: 40, height: 20, name: 'photo.png' })
    expect(first[0]).not.toHaveProperty('path')
    expect((await store.add([path]))[0].id).toBe(first[0].id)
    await expect(store.read('../../secret')).rejects.toThrow()
    expect((await store.read(first[0].id)).bytes).toEqual(bytes)
    const other = join(dir, 'other.png'); await writeFile(other, bytes)
    await expect(store.add([other, bad])).rejects.toThrow()
    expect(store.list()).toHaveLength(1)
    await expect(store.add(Array.from({ length: 101 }, (_, i) => join(dir, String(i))))).rejects.toThrow('100')
    await writeFile(path, PNG.sync.write(new PNG({ width: 20, height: 40 })))
    await expect(store.read(first[0].id)).rejects.toThrow('변경')
    store.clear(); expect(store.list()).toEqual([])
  } finally { await rm(dir, { recursive: true, force: true }) }
})

it('폴더의 JPG/PNG를 이름순으로 가져오고 손상 파일·하위 폴더를 제외한다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'photokkumi-folder-'))
  try {
    const fs = await import('node:fs/promises')
    const png = PNG.sync.write(new PNG({ width: 40, height: 20 }))
    await writeFile(join(dir, '2.PNG'), png); await writeFile(join(dir, '1.png'), png)
    await writeFile(join(dir, 'bad.jpg'), 'invalid'); await writeFile(join(dir, 'notes.txt'), 'notes')
    await fs.mkdir(join(dir, 'nested')); await writeFile(join(dir, 'nested', 'hidden.png'), png)
    if (process.platform !== 'win32') await fs.symlink(join(dir, 'nested', 'hidden.png'), join(dir, 'link.png'))
    const store = new PhotoStore(() => 'thumb')
    const result = await store.addFolder(dir)
    expect(result.photos.map(item => item.name)).toEqual(['1.png', '2.PNG'])
    expect(result.rejected).toEqual(['bad.jpg'])
    expect((await store.addFolder(dir)).photos).toHaveLength(2)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

it('100장 초과 폴더를 일부 등록하지 않고 기존 사진을 보존한다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'photokkumi-folder-limit-'))
  try {
    const fs = await import('node:fs/promises')
    const png = PNG.sync.write(new PNG({ width: 4, height: 4 }))
    const original = join(dir, 'original.png'); await writeFile(original, png)
    const folder = join(dir, 'overflow'); await fs.mkdir(folder)
    await Promise.all(Array.from({ length: 101 }, (_, i) => writeFile(join(folder, `${i}.png`), png)))
    const store = new PhotoStore(() => 'thumb')
    const initial = await store.add([original])
    await expect(store.addFolder(folder)).rejects.toThrow('100')
    expect(store.list()).toEqual(initial)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

it('끌어 놓은 파일·폴더를 기존 목록에 추가하고 동영상·기타·symlink는 제외하며 제거할 수 있다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'photokkumi-drop-'))
  try {
    const fs = await import('node:fs/promises')
    const png = PNG.sync.write(new PNG({ width: 40, height: 20 }))
    const first = join(dir, 'a.png'), folder = join(dir, '폴더'), clip = join(dir, 'clip.mov'), link = join(dir, 'link.png')
    await writeFile(first, png); await fs.mkdir(folder)
    await writeFile(join(folder, '2.png'), png); await writeFile(join(folder, '1.jpg'), 'broken'); await writeFile(join(folder, 'memo.txt'), 'x')
    await writeFile(clip, 'not decoded yet'); await fs.symlink(first, link)
    const store = new PhotoStore(() => 'thumb')
    const existing = await store.add([first])
    const result = await store.addDropped([first, folder, clip, link, join(dir, 'missing.png')])
    expect(result.photos.map(item => item.name)).toEqual(['a.png', '2.png'])
    expect(result.photos[0].id).toBe(existing[0].id)
    expect(result.rejected.sort()).toEqual(['1.jpg', 'clip.mov', 'link.png', 'missing.png'].sort())
    expect(store.remove(result.photos[0].id).map(item => item.name)).toEqual(['2.png'])
    expect(() => store.remove(result.photos[0].id)).toThrow()
    await expect(store.read(result.photos[0].id)).rejects.toThrow()
    for (const invalid of [[], ['relative.png'], ['/a\0b.png'], [1], Array.from({ length: 201 }, () => first), 'x']) expect(validDroppedPaths(invalid)).toBe(false)
    await expect(store.addDropped(['relative.png'])).rejects.toThrow()
  } finally { await rm(dir, { recursive: true, force: true }) }
})
