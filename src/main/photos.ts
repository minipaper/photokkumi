import { createHash, randomUUID } from 'node:crypto'
import { realpath, opendir, lstat, mkdir, writeFile, rm } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join } from 'node:path'
import type { ImageAsset, PhotoInfo } from '../shared/model'
import { inspectImage, MAX_FILE_BYTES } from './images'
import { readBounded } from './library'
import { HEIC_EXTENSIONS, isHeic } from './heic'

/** `converted`: the JPEG made from a HEIC original, kept in the app's cache folder while the photo is open. */
interface ManagedPhoto { info: PhotoInfo; path: string; hash: string; converted?: string }
/** Turns HEIC bytes into JPG/PNG bytes the editor can decode; `directory` holds the converted copies. */
export interface HeicConverter { directory: string; convert(bytes: Uint8Array): Promise<Buffer> }
export class PhotoStore {
  private records = new Map<string, ManagedPhoto>()
  /** Called after each file of a batch so a long HEIC conversion can show progress. */
  onProgress?: (done: number, total: number) => void
  constructor(private thumbnail: (bytes: Buffer) => string, private heic?: HeicConverter) {}
  list(): PhotoInfo[] { return [...this.records.values()].map(item => item.info) }
  get(id: string): ManagedPhoto {
    const photo = this.records.get(id)
    if (!photo) throw new Error('허용되지 않은 사진입니다.')
    return photo
  }
  clear() {
    for (const record of this.records.values()) this.dropConverted(record)
    this.records.clear()
  }
  remove(id: string): PhotoInfo[] {
    this.dropConverted(this.get(id))
    this.records.delete(id)
    return this.list()
  }
  private dropConverted(record: ManagedPhoto) { if (record.converted) void rm(record.converted, { force: true }).catch(() => undefined) }
  /** HEIC → JPG/PNG copy in the cache folder; other formats pass through untouched. */
  private async decodable(bytes: Buffer): Promise<{ bytes: Buffer; converted?: string }> {
    if (!isHeic(bytes)) return { bytes }
    if (!this.heic) throw new Error('HEIC 사진을 열 수 없습니다.')
    const converted = await this.heic.convert(bytes)
    await mkdir(this.heic.directory, { recursive: true })
    const path = join(this.heic.directory, `${randomUUID()}${converted[0] === 0x89 ? '.png' : '.jpg'}`)
    await writeFile(path, converted, { flag: 'wx' })
    return { bytes: converted, converted: path }
  }
  async add(paths: string[], rejected?: string[], folderRoot?: string): Promise<PhotoInfo[]> {
    // Limit before I/O; stage every candidate before granting any new ID.
    if (paths.length > 100) throw new Error('사진은 최대 100장까지 열 수 있습니다.')
    const candidates = new Map([...this.records.values()].map(item => [item.path, item]))
    const staged: string[] = []
    try {
      for (const [index, input] of paths.entries()) {
        if (index) this.onProgress?.(index, paths.length)
        let path: string
        try {
          path = await realpath(input)
          if (folderRoot && dirname(path) !== folderRoot) throw new Error('선택한 폴더 밖의 파일입니다.')
        } catch (error) {
          if (!rejected) throw error
          rejected.push(basename(input)); continue
        }
        if (candidates.has(path)) continue
        if (candidates.size >= 100) throw new Error('사진은 최대 100장까지 열 수 있습니다.')
        let converted: string | undefined
        try {
          const bytes = await readBounded(path, MAX_FILE_BYTES)
          const image = await this.decodable(bytes)
          if ((converted = image.converted)) staged.push(converted)
          const dimensions = inspectImage(image.bytes, 'photo')
          const thumbnail = this.thumbnail(image.bytes) // Decode one candidate at a time; retain only a small thumbnail.
          const info: PhotoInfo = { id: randomUUID(), name: basename(path), ...dimensions, thumbnail }
          candidates.set(path, { info, path, hash: createHash('sha256').update(bytes).digest('hex'), converted })
        } catch (error) {
          if (converted) { void rm(converted, { force: true }).catch(() => undefined); staged.pop() }
          if (!rejected) throw error
          rejected.push(basename(path))
        }
      }
    } catch (error) {
      for (const path of staged) void rm(path, { force: true }).catch(() => undefined)
      throw error
    }
    this.records = new Map([...candidates.values()].map(item => [item.info.id, item]))
    return this.list()
  }
  async addFolder(directory: string): Promise<{ photos: PhotoInfo[]; rejected: string[] }> {
    const root = await realpath(directory)
    const rejected: string[] = []
    return { photos: await this.add(await folderImages(root), rejected, root), rejected }
  }
  /** Files and folders dropped from the OS file manager. Folders contribute their direct JPG/PNG/HEIC children only. */
  async addDropped(inputs: string[]): Promise<{ photos: PhotoInfo[]; rejected: string[] }> {
    if (!validDroppedPaths(inputs)) throw new Error('끌어 놓은 항목을 확인할 수 없습니다.')
    const files: string[] = [], rejected: string[] = []
    for (const input of inputs) {
      let info
      try { info = await lstat(input) } catch { rejected.push(basename(input)); continue }
      if (info.isSymbolicLink()) rejected.push(basename(input))
      else if (info.isDirectory()) files.push(...await folderImages(await realpath(input)))
      else if (info.isFile() && IMAGE_EXTENSIONS.includes(extname(input).toLowerCase())) files.push(input)
      else rejected.push(basename(input))
      if (files.length > 100) throw new Error('사진은 최대 100장까지 열 수 있습니다. 나누어 끌어 놓으세요.')
    }
    return { photos: await this.add(files, rejected), rejected }
  }
  async read(id: string): Promise<ImageAsset> {
    const record = this.get(id)
    const bytes = await readBounded(record.path, MAX_FILE_BYTES)
    if (createHash('sha256').update(bytes).digest('hex') !== record.hash) throw new Error('사진 원본이 변경되었습니다. 앱을 다시 시작한 뒤 사진을 여세요.')
    const { id: photoId, name, width, height, mime } = record.info
    if (!record.converted) return { id: photoId, name, width, height, mime, bytes }
    let image: Buffer
    try { image = await readBounded(record.converted, MAX_FILE_BYTES) }
    catch {
      // The cached copy went missing (cleaned up outside the app): convert the verified original again.
      const again = await this.decodable(bytes)
      const size = inspectImage(again.bytes, 'photo')
      if (size.width !== width || size.height !== height) { if (again.converted) void rm(again.converted, { force: true }).catch(() => undefined); throw new Error('HEIC 사진을 다시 읽지 못했습니다.') }
      record.converted = again.converted; image = again.bytes
    }
    return { id: photoId, name, width, height, mime, bytes: image }
  }
}

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', ...HEIC_EXTENSIONS]
export function validDroppedPaths(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 200
    && value.every(item => typeof item === 'string' && item.length > 0 && item.length < 4096 && !item.includes('\0') && isAbsolute(item))
}
async function folderImages(root: string): Promise<string[]> {
  const paths: string[] = []
  for await (const entry of await opendir(root)) {
    if (!entry.isFile() || !IMAGE_EXTENSIONS.includes(extname(entry.name).toLowerCase())) continue
    paths.push(join(root, entry.name))
    if (paths.length > 100) throw new Error('폴더에 사진이 100장보다 많습니다. 파일을 나누어 선택하세요.')
  }
  return paths.sort((a, b) => basename(a).localeCompare(basename(b), 'ko', { numeric: true }))
}
