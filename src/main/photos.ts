import { createHash, randomUUID } from 'node:crypto'
import { realpath, opendir } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import type { ImageAsset, PhotoInfo } from '../shared/model'
import { inspectImage, MAX_FILE_BYTES } from './images'
import { readBounded } from './library'

interface ManagedPhoto { info: PhotoInfo; path: string; hash: string }
export class PhotoStore {
  private records = new Map<string, ManagedPhoto>()
  constructor(private thumbnail: (bytes: Buffer) => string) {}
  list(): PhotoInfo[] { return [...this.records.values()].map(item => item.info) }
  get(id: string): ManagedPhoto {
    const photo = this.records.get(id)
    if (!photo) throw new Error('허용되지 않은 사진입니다.')
    return photo
  }
  clear() { this.records.clear() }
  async add(paths: string[], rejected?: string[], folderRoot?: string): Promise<PhotoInfo[]> {
    // Limit before I/O; stage every candidate before granting any new ID.
    if (paths.length > 100) throw new Error('사진은 최대 100장까지 열 수 있습니다.')
    const candidates = new Map([...this.records.values()].map(item => [item.path, item]))
    for (const input of paths) {
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
      try {
        const bytes = await readBounded(path, MAX_FILE_BYTES)
        const dimensions = inspectImage(bytes, 'photo')
        const thumbnail = this.thumbnail(bytes) // Decode one candidate at a time; retain only a small thumbnail.
        const info: PhotoInfo = { id: randomUUID(), name: basename(path), ...dimensions, thumbnail }
        candidates.set(path, { info, path, hash: createHash('sha256').update(bytes).digest('hex') })
      } catch (error) {
        if (!rejected) throw error
        rejected.push(basename(path))
      }
    }
    this.records = new Map([...candidates.values()].map(item => [item.info.id, item]))
    return this.list()
  }
  async addFolder(directory: string): Promise<{ photos: PhotoInfo[]; rejected: string[] }> {
    const root = await realpath(directory)
    const paths: string[] = []
    for await (const entry of await opendir(root)) {
      if (!entry.isFile() || !['.jpg', '.jpeg', '.png'].includes(extname(entry.name).toLowerCase())) continue
      paths.push(join(root, entry.name))
      if (paths.length > 100) throw new Error('폴더에 사진이 100장보다 많습니다. 파일을 나누어 선택하세요.')
    }
    paths.sort((a, b) => basename(a).localeCompare(basename(b), 'ko', { numeric: true }))
    const rejected: string[] = []
    return { photos: await this.add(paths, rejected, root), rejected }
  }
  async read(id: string): Promise<ImageAsset> {
    const record = this.get(id)
    const bytes = await readBounded(record.path, MAX_FILE_BYTES)
    if (createHash('sha256').update(bytes).digest('hex') !== record.hash) throw new Error('사진 원본이 변경되었습니다. 앱을 다시 시작한 뒤 사진을 여세요.')
    const { id: photoId, name, width, height, mime } = record.info
    return { id: photoId, name, width, height, mime, bytes }
  }
}
