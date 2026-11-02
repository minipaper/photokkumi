import fs from 'node:fs/promises'
import { constants } from 'node:fs'
import { randomUUID, createHash } from 'node:crypto'
import { basename, extname, join } from 'node:path'
import type { LibraryManifest, LibrarySticker, StickerMetadata } from '../shared/library'
import { MAX_BACKUP_BYTES, MAX_LIBRARY_BYTES, MAX_MANIFEST_BYTES, MAX_STICKERS, parseManifest, validAssetId, validMetadata } from '../shared/library'
import { inspectImage, MAX_FILE_BYTES } from './images'
import { createBackup, readBackup } from './zip'
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

export async function readBounded(path: string, max: number): Promise<Buffer> {
  const stat = await fs.lstat(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > max) throw new Error('지원하지 않는 파일이거나 크기 제한을 초과했습니다.')
  const handle = await fs.open(path, 'r')
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > max) throw new Error('파일 크기 제한을 초과했습니다.')
    const bytes = Buffer.alloc(info.size)
    let count = 0
    while (count < bytes.length) {
      const read = await handle.read(bytes, count, bytes.length - count, count)
      if (!read.bytesRead) break
      count += read.bytesRead
    }
    if (count !== bytes.length) throw new Error('파일 읽기가 중단되었습니다.')
    return bytes
  } finally { await handle.close() }
}
export class StickerLibrary {
  private manifest: LibraryManifest = { schemaVersion: 1, stickers: [] }
  private loaded = false
  constructor(private root: string, private normalize: (bytes: Uint8Array) => Uint8Array) {}
  private file(id: string) {
    if (!validAssetId(id)) throw new Error('잘못된 스티커 ID입니다.')
    return join(this.root, 'stickers', `${id}.png`)
  }
  list(): LibrarySticker[] {
    if (!this.loaded) throw new Error('라이브러리를 불러오지 못했습니다. 기존 데이터를 확인하세요.')
    return structuredClone(this.manifest.stickers)
  }
  async load() {
    await fs.mkdir(join(this.root, 'stickers'), { recursive: true })
    if ((await fs.lstat(join(this.root, 'stickers'))).isSymbolicLink()) throw new Error('스티커 폴더가 링크입니다.')
    let bytes: Buffer
    try { bytes = await readBounded(join(this.root, 'library.json'), MAX_MANIFEST_BYTES) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      this.loaded = true; return
    }
    const manifest = parseManifest(JSON.parse(bytes.toString('utf8')))
    let total = 0
    for (const asset of manifest.stickers) {
      const data = await readBounded(this.file(asset.id), MAX_FILE_BYTES)
      const info = inspectImage(data, 'sticker')
      total += data.length
      if (hash(data) !== asset.hash || info.width !== asset.width || info.height !== asset.height || total > MAX_LIBRARY_BYTES) throw new Error('스티커 파일이 손상되었습니다.')
    }
    this.manifest = manifest; this.loaded = true
  }
  async read(id: string): Promise<Buffer> {
    const asset = this.list().find(item => item.id === id)
    if (!asset) throw new Error('스티커를 찾을 수 없습니다.')
    const data = await readBounded(this.file(id), MAX_FILE_BYTES)
    if (hash(data) !== asset.hash) throw new Error('스티커 파일이 변경되었습니다.')
    return data
  }
  private async commit(stickers: LibrarySticker[]) {
    const manifest = parseManifest({ schemaVersion: 1, stickers })
    const bytes = JSON.stringify(manifest, null, 2)
    if (Buffer.byteLength(bytes) > MAX_MANIFEST_BYTES) throw new Error('메타데이터 크기 제한을 초과했습니다.')
    const temporary = join(this.root, `.${randomUUID()}.tmp`)
    const handle = await fs.open(temporary, 'wx', 0o600)
    try {
      try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
      await fs.rename(temporary, join(this.root, 'library.json'))
      this.manifest = manifest
    } finally { await fs.unlink(temporary).catch(() => undefined) }
  }
  private prepare(bytes: Uint8Array, metadata: Omit<LibrarySticker, 'id' | 'hash' | 'width' | 'height'>) {
    inspectImage(bytes, 'sticker')
    const normalized = Buffer.from(this.normalize(bytes))
    const info = inspectImage(normalized, 'sticker')
    return { bytes: normalized, asset: { ...metadata, id: randomUUID(), hash: hash(normalized), width: info.width, height: info.height } }
  }
  private async merge(candidates: ReturnType<StickerLibrary['prepare']>[]) {
    const current = this.list(), known = new Set(current.map(item => item.hash))
    const added = candidates.filter(item => { if (known.has(item.asset.hash)) return false; known.add(item.asset.hash); return true })
    if (current.length + added.length > MAX_STICKERS) throw new Error('라이브러리는 최대 100개입니다.')
    let total = added.reduce((sum, item) => sum + item.bytes.length, 0)
    for (const item of current) total += (await fs.stat(this.file(item.id))).size
    if (total > MAX_LIBRARY_BYTES) throw new Error('라이브러리는 최대 256 MiB입니다.')
    if (!added.length) return
    const stage = await fs.mkdtemp(join(this.root, '.import-'))
    const copied: string[] = []
    try {
      for (const item of added) {
        const path = join(stage, `${item.asset.id}.png`)
        await fs.writeFile(path, item.bytes, { flag: 'wx', mode: 0o600 })
        const target = this.file(item.asset.id)
        await fs.copyFile(path, target, constants.COPYFILE_EXCL); copied.push(target)
        const handle = await fs.open(target, 'r+')
        try { await handle.sync() } finally { await handle.close() }
      }
      await this.commit([...current, ...added.map(item => item.asset)])
    } catch (error) { await Promise.all(copied.map(path => fs.unlink(path).catch(() => undefined))); throw error }
    finally { await fs.rm(stage, { recursive: true, force: true }) }
  }
  async importFiles(paths: string[]) {
    this.list()
    if (!paths.length || paths.length > MAX_STICKERS) throw new Error('한 번에 PNG 1~100개를 선택하세요.')
    const candidates: ReturnType<StickerLibrary['prepare']>[] = []
    let total = 0
    for (const path of paths) {
      const bytes = await readBounded(path, MAX_FILE_BYTES)
      const item = this.prepare(bytes, { name: basename(path, extname(path)).slice(0, 80) || '스티커', originalName: basename(path).slice(0, 255), category: '', favorite: false })
      total += item.bytes.length
      if (total > MAX_LIBRARY_BYTES) throw new Error('등록 크기 제한을 초과했습니다.')
      candidates.push(item)
    }
    await this.merge(candidates)
    const stickers = this.list()
    return { stickers, importedIds: candidates.map(item => stickers.find(asset => asset.hash === item.asset.hash)!.id) }
  }
  async update(id: string, metadata: StickerMetadata) {
    if (!validAssetId(id) || !validMetadata(metadata)) throw new Error('잘못된 스티커 메타데이터입니다.')
    const current = this.list()
    if (!current.some(item => item.id === id)) throw new Error('스티커를 찾을 수 없습니다.')
    await this.commit(current.map(item => item.id === id ? { ...item, ...metadata, name: metadata.name.trim(), category: metadata.category.trim() } : item))
    return this.list()
  }
  async remove(id: string, activeIds: string | string[] | null) {
    if (Array.isArray(activeIds) ? activeIds.includes(id) : id === activeIds) throw new Error('현재 사진 또는 실행취소 이력에서 사용 중인 스티커는 삭제할 수 없습니다. 사진의 배치·이력을 비우거나 앱을 다시 열어주세요.')
    const current = this.list()
    if (!current.some(item => item.id === id)) throw new Error('스티커를 찾을 수 없습니다.')
    await this.commit(current.filter(item => item.id !== id))
    // Commit metadata first: a failed manifest write must never destroy a live asset.
    try { await fs.unlink(this.file(id)) }
    catch (error) {
      try { await this.commit(current) }
      catch (rollback) { throw new AggregateError([error, rollback], '스티커 파일은 보존되었지만 삭제 목록 복구에 실패했습니다. 라이브러리를 다시 확인하세요.', { cause: rollback }) }
      throw new Error('스티커 파일을 삭제하지 못해 기존 항목을 유지했습니다.', { cause: error })
    }
    return this.list()
  }
  async backup(): Promise<Buffer> {
    const entries = new Map<string, Buffer>([['library.json', Buffer.from(JSON.stringify({ schemaVersion: 1, stickers: this.list() }))]])
    for (const item of this.list()) entries.set(`stickers/${item.id}.png`, await this.read(item.id))
    return createBackup(entries)
  }
  async restore(buffer: Buffer) {
    if (buffer.length > MAX_BACKUP_BYTES) throw new Error('백업 크기 제한을 초과했습니다.')
    const files = await readBackup(buffer)
    const json = files.get('library.json')
    if (!json) throw new Error('백업에 manifest가 없습니다.')
    const manifest = parseManifest(JSON.parse(json.toString('utf8')))
    if (files.size !== manifest.stickers.length + 1) throw new Error('백업 항목 목록이 일치하지 않습니다.')
    const candidates: ReturnType<StickerLibrary['prepare']>[] = []
    for (const item of manifest.stickers) {
      const bytes = files.get(`stickers/${item.id}.png`)
      if (!bytes || hash(bytes) !== item.hash) throw new Error('백업 스티커 해시가 다릅니다.')
      const candidate = this.prepare(bytes, item)
      if (candidate.asset.width !== item.width || candidate.asset.height !== item.height) throw new Error('백업 스티커 크기가 다릅니다.')
      candidates.push(candidate)
    }
    await this.merge(candidates)
    return this.list()
  }
}
