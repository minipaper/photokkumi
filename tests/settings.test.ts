import { it, expect, vi } from 'vitest'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OutputStore } from '../src/main/settings'
import { DEFAULT_OUTPUT } from '../src/shared/output'
it('설정 기본값·재실행·쓰기 실패·손상 파일 보존을 검증한다', async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), 'photokkumi-settings-'))
  try {
    const store = new OutputStore(dir)
    expect(await store.get()).toEqual(DEFAULT_OUTPUT)
    const output = { ...DEFAULT_OUTPUT, format: 'jpg' as const, width: 800 }
    await store.set(output)
    await Promise.all([store.set({ ...output, width: 700 }), store.set(output)])
    expect(await new OutputStore(dir).get()).toEqual(output)
    const before = await fs.readFile(join(dir, 'settings.json'))
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('denied'))
    await expect(store.set({ ...output, width: 400 })).rejects.toThrow('denied')
    expect(await store.get()).toEqual(output)
    expect(await fs.readFile(join(dir, 'settings.json'))).toEqual(before)
    expect(await fs.readdir(dir)).toEqual(['settings.json'])
    await expect(store.set({ ...output, width: NaN })).rejects.toThrow()
    await fs.writeFile(join(dir, 'settings.json'), '{bad')
    await expect(new OutputStore(dir).get()).rejects.toThrow()
    await expect(new OutputStore(dir).set(output)).rejects.toThrow()
    expect(await fs.readFile(join(dir, 'settings.json'), 'utf8')).toBe('{bad')
  } finally { vi.restoreAllMocks(); await fs.rm(dir, { recursive: true, force: true }) }
})
