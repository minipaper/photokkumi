import { afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import { join, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { PNG } from 'pngjs'
import { StickerLibrary } from '../src/main/library'
import { parseManifest } from '../src/shared/library'
const folders: string[] = []
async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), 'kkumi-library-')); folders.push(root)
  const source = join(root, '개인 스티커.png')
  const p = new PNG({ width: 8, height: 4 }); p.data.fill(200)
  await fs.writeFile(source, PNG.sync.write(p))
  const normalize = (bytes: Uint8Array) => PNG.sync.write(PNG.sync.read(Buffer.from(bytes)))
  const create = (path = join(root, 'profile')) => new StickerLibrary(path, normalize)
  return { root, source, create }
}
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(folders.splice(0).map(path => fs.rm(path, { recursive: true, force: true }))) })
it('다중 중복 등록, 원본 이동 후 재시작, 메타데이터 유지와 참조 중 삭제 차단', async () => {
  const { root, source, create } = await fixture(); const library = create()
  await library.load(); await library.importFiles([source, source])
  const [asset] = library.list(); expect(library.list()).toHaveLength(1)
  expect(() => parseManifest({ schemaVersion: 1, stickers: [{ ...asset, hash: [asset.hash] }] })).toThrow()
  await library.update(asset.id, { name: '양', category: '동물', favorite: true })
  await fs.rename(source, join(root, '옮긴 원본.png'))
  const restarted = create(); await restarted.load()
  expect(restarted.list()[0]).toMatchObject({ name: '양', category: '동물', favorite: true })
  expect((await restarted.read(asset.id)).length).toBeGreaterThan(0)
  await expect(restarted.remove(asset.id, asset.id)).rejects.toThrow('사용 중')
  await restarted.remove(asset.id, null)
  expect(await fs.readFile(join(root, '옮긴 원본.png'))).toBeTruthy()
  const again = create(); await again.load(); expect(again.list()).toEqual([])
})
it('manifest 교체 실패 시 기존 manifest와 파일을 보존한다', async () => {
  const { root, source, create } = await fixture(); const library = create(); await library.load(); await library.importFiles([source])
  const before = await fs.readFile(join(root, 'profile', 'library.json'))
  vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('disk failure'))
  await expect(library.update(library.list()[0].id, { name: '변경', category: '', favorite: true })).rejects.toThrow()
  expect(await fs.readFile(join(root, 'profile', 'library.json'))).toEqual(before)
  expect(library.list()[0].name).toBe('개인 스티커')
})
it('손상된 manifest는 빈 라이브러리로 덮어쓰지 않는다', async () => {
  const { root, create } = await fixture(); await fs.mkdir(join(root, 'profile'))
  await fs.writeFile(join(root, 'profile', 'library.json'), '{broken')
  await expect(create().load()).rejects.toThrow()
  expect(await fs.readFile(join(root, 'profile', 'library.json'), 'utf8')).toBe('{broken')
  expect(() => parseManifest({ schemaVersion: 999, stickers: [] })).toThrow()
})
it('백업 round-trip, 기존 항목 우선 병합, 취소 없는 원본 보존', async () => {
  const { root, source, create } = await fixture(); const library = create(); await library.load(); await library.importFiles([source])
  const backup = await library.backup(); const restored = create(join(root, 'other')); await restored.load(); await restored.restore(backup)
  expect(restored.list()[0].hash).toBe(library.list()[0].hash)
  const id = restored.list()[0].id
  await restored.update(id, { name: '기존 이름', category: '', favorite: true }); await restored.restore(backup)
  expect(restored.list()).toHaveLength(1); expect(restored.list()[0].name).toBe('기존 이름')
  expect(basename(source)).toBe('개인 스티커.png')
})

function storedZip(name: string, data = Buffer.from('payload'), options: { mode?: number; size?: number; crc?: number } = {}) {
  const n = Buffer.from(name), local = Buffer.alloc(30), central = Buffer.alloc(46), end = Buffer.alloc(22)
  const crc = options.crc ?? crc32(data)
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(data.length, 18); local.writeUInt32LE(options.size ?? data.length, 22); local.writeUInt16LE(n.length, 26)
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(0x0314, 4); central.writeUInt16LE(20, 6)
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(options.size ?? data.length, 24)
  central.writeUInt16LE(n.length, 28); central.writeUInt32LE(((options.mode ?? 0x81a4) * 65536) >>> 0, 38)
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10)
  end.writeUInt32LE(central.length + n.length, 12); end.writeUInt32LE(local.length + n.length + data.length, 16)
  return Buffer.concat([local, n, data, central, n, end])
}
import { crc32 } from 'node:zlib'
import { readBackup, createBackup } from '../src/main/zip'
import { MAX_FILE_BYTES } from '../src/main/images'
import { MAX_BACKUP_BYTES } from '../src/shared/library'

it.each(['../escape.png', '/absolute.png', 'C:/absolute.png', 'stickers\\escape.png', 'unknown.txt'])('악성 ZIP 경로 %s는 기존 데이터 없이도 거부한다', async name => {
  await expect(readBackup(storedZip(name))).rejects.toThrow()
})
it('symlink, 초과 크기, CRC 손상과 과다 항목을 거부한다', async () => {
  const name = 'stickers/00000000-0000-4000-8000-000000000000.png'
  await expect(readBackup(storedZip(name, Buffer.from('target'), { mode: 0xa1ff }))).rejects.toThrow()
  await expect(readBackup(storedZip(name, Buffer.from('x'), { size: MAX_FILE_BYTES + 1 }))).rejects.toThrow()
  await expect(readBackup(storedZip(name, Buffer.from('x'), { crc: 42 }))).rejects.toThrow()
  const many = storedZip('library.json'); many.writeUInt16LE(102, many.length - 12); many.writeUInt16LE(102, many.length - 14)
  await expect(readBackup(many)).rejects.toThrow()
  await expect(readBackup(Buffer.alloc(MAX_BACKUP_BYTES + 1))).rejects.toThrow()
})
it('복원 검증 실패와 새 파일 복사/manifest 실패는 기존 항목을 유지한다', async () => {
  const { root, source, create } = await fixture(); const library = create(); await library.load(); await library.importFiles([source])
  const before = await fs.readFile(join(root, 'profile', 'library.json'))
  const bad = await createBackup(new Map([['library.json', Buffer.from('{"schemaVersion":99,"stickers":[]}')]]))
  await expect(library.restore(bad)).rejects.toThrow()
  const png = new PNG({ width: 4, height: 2 }); png.data.fill(12)
  const second = join(root, 'second.png'); await fs.writeFile(second, PNG.sync.write(png))
  vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('write failed'))
  await expect(library.importFiles([second])).rejects.toThrow()
  expect(await fs.readFile(join(root, 'profile', 'library.json'))).toEqual(before)
  expect(await fs.readdir(join(root, 'profile', 'stickers'))).toHaveLength(1)
  expect(library.list()).toHaveLength(1)
})
it('관리 복사본 삭제 권한 실패 시 manifest를 되돌리고 원본을 유지한다', async () => {
  const { root, source, create } = await fixture(); const library = create(); await library.load(); await library.importFiles([source])
  const asset = library.list()[0], before = await fs.readFile(join(root, 'profile', 'library.json'))
  const unlink = fs.unlink.bind(fs)
  vi.spyOn(fs, 'unlink').mockImplementation(async path => {
    if (String(path).endsWith(`${asset.id}.png`)) throw Object.assign(new Error('denied'), { code: 'EACCES' })
    return unlink(path)
  })
  await expect(library.remove(asset.id, null)).rejects.toThrow('기존 항목을 유지')
  expect(await fs.readFile(join(root, 'profile', 'library.json'))).toEqual(before)
  expect(library.list()[0].id).toBe(asset.id)
  expect(await fs.readFile(source)).toBeTruthy()
})
it('등록 중 PNG 디코드 실패는 다른 정상 PNG도 부분 등록하지 않는다', async () => {
  const { root, source, create } = await fixture(); const library = create(); await library.load()
  const bad = join(root, 'bad.png'), bytes = await fs.readFile(source); await fs.writeFile(bad, bytes.subarray(0, 33))
  await expect(library.importFiles([source, bad])).rejects.toThrow()
  expect(library.list()).toEqual([])
  expect(await fs.readdir(join(root, 'profile', 'stickers'))).toEqual([])
})
it('새 관리 파일 복사 실패는 기존 manifest를 보존하고 staging을 정리한다', async () => {
  const { root, source, create } = await fixture(); const library = create(); await library.load()
  vi.spyOn(fs, 'copyFile').mockRejectedValueOnce(new Error('copy denied'))
  await expect(library.importFiles([source])).rejects.toThrow('copy denied')
  expect(library.list()).toEqual([])
  expect(await fs.readdir(join(root, 'profile', 'stickers'))).toEqual([])
  expect((await fs.readdir(join(root, 'profile'))).filter(name => name.startsWith('.import-'))).toEqual([])
})
