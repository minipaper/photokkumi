import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { PrefsStore, validBounds } from '../src/main/prefs'

const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))) })
const temp = async () => { const dir = await mkdtemp(join(tmpdir(), 'pk-prefs-')); dirs.push(dir); return dir }

it('출력 폴더·사진 폴더·창 위치를 저장하고 다시 읽는다', async () => {
  const dir = await temp(), folder = join(dir, '결과 폴더')
  await new PrefsStore(dir).update({ outputFolder: folder, window: { x: 10, y: 20, width: 1300, height: 900, maximized: true } })
  await new PrefsStore(dir).update({ photoFolder: dir })
  expect(await new PrefsStore(dir).get()).toEqual({ outputFolder: folder, photoFolder: dir, window: { x: 10, y: 20, width: 1300, height: 900, maximized: true }, defaultStickers: 0 })
  expect(JSON.parse(await readFile(join(dir, 'prefs.json'), 'utf8')).schemaVersion).toBe(1)
})

it('손상·잘못된 값은 기본값으로 읽고, 상대 경로나 비정상 창 크기는 저장하지 않는다', async () => {
  const dir = await temp()
  await writeFile(join(dir, 'prefs.json'), '{ broken')
  expect(await new PrefsStore(dir).get()).toEqual({ outputFolder: null, photoFolder: null, window: null, defaultStickers: 0 })
  await writeFile(join(dir, 'prefs.json'), JSON.stringify({ schemaVersion: 1, outputFolder: '../escape', photoFolder: 'C:', window: { x: 0, y: 0, width: 5, height: 5, maximized: false } }))
  expect(await new PrefsStore(dir).get()).toEqual({ outputFolder: null, photoFolder: null, window: null, defaultStickers: 0 })
  const store = new PrefsStore(dir)
  await store.update({ outputFolder: 'relative/path' })
  expect((await new PrefsStore(dir).get()).outputFolder).toBeNull()
  expect(validBounds({ x: 0, y: 0, width: 800, height: 600, maximized: false })).toBe(true)
  expect(validBounds({ x: 0.5, y: 0, width: 800, height: 600, maximized: false })).toBe(false)
})

it('창 닫기 경로의 동기 저장은 이전 값과 합쳐 저장하고 임시 파일을 남기지 않는다', async () => {
  const dir = await temp()
  const store = new PrefsStore(dir)
  store.updateSync({ window: { x: 1, y: 2, width: 900, height: 700, maximized: false } }) // not loaded yet: ignored
  await store.update({ outputFolder: dir })
  store.updateSync({ window: { x: 1, y: 2, width: 900, height: 700, maximized: false } })
  expect(await new PrefsStore(dir).get()).toMatchObject({ outputFolder: dir, window: { width: 900 } })
  const { readdir } = await import('node:fs/promises')
  expect((await readdir(dir)).filter(name => name.endsWith('.tmp'))).toEqual([])
})
