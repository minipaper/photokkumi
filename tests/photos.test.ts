import { it, expect } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { PhotoStore } from '../src/main/photos'

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
