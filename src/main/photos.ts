import { createHash, randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { basename } from 'node:path'
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
  async add(paths: string[]): Promise<PhotoInfo[]> {
    // Limit before I/O; stage every candidate before granting any new ID.
    if (paths.length > 100) throw new Error('사진은 최대 100장까지 열 수 있습니다.')
    const candidates = new Map([...this.records.values()].map(item => [item.path, item]))
    for (const input of paths) {
      const path = await realpath(input)
      if (candidates.has(path)) continue
      if (candidates.size >= 100) throw new Error('사진은 최대 100장까지 열 수 있습니다.')
      const bytes = await readBounded(path, MAX_FILE_BYTES)
      const dimensions = inspectImage(bytes, 'photo')
      const thumbnail = this.thumbnail(bytes) // Decode one candidate at a time; retain only a small thumbnail.
      const info: PhotoInfo = { id: randomUUID(), name: basename(path), ...dimensions, thumbnail }
      candidates.set(path, { info, path, hash: createHash('sha256').update(bytes).digest('hex') })
    }
    this.records = new Map([...candidates.values()].map(item => [item.info.id, item]))
    return this.list()
  }
  async read(id: string): Promise<ImageAsset> {
    const record = this.get(id)
    const bytes = await readBounded(record.path, MAX_FILE_BYTES)
    if (createHash('sha256').update(bytes).digest('hex') !== record.hash) throw new Error('사진 원본이 변경되었습니다. 앱을 다시 시작한 뒤 사진을 여세요.')
    const { id: photoId, name, width, height, mime } = record.info
    return { id: photoId, name, width, height, mime, bytes }
  }
}
