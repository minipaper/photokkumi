import { fromBuffer } from 'yauzl'
import { ZipFile } from 'yazl'
import type { Readable } from 'node:stream'
import { crc32 } from 'node:zlib'
import { MAX_BACKUP_BYTES, MAX_LIBRARY_BYTES, MAX_MANIFEST_BYTES, MAX_STICKERS, validAssetId } from '../shared/library'
import { MAX_FILE_BYTES } from './images'

export async function createBackup(entries: Map<string, Buffer>): Promise<Buffer> {
  const zip = new ZipFile()
  const done = new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []; let size = 0
    zip.outputStream.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BACKUP_BYTES) { (zip.outputStream as Readable).destroy(new Error('백업 크기 제한을 초과했습니다.')); return }
      chunks.push(chunk)
    })
    zip.on('error', reject); zip.outputStream.on('error', reject)
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)))
  })
  for (const [name, bytes] of entries) zip.addBuffer(bytes, name)
  zip.end()
  return done
}
export function readBackup(buffer: Buffer): Promise<Map<string, Buffer>> {
  if (buffer.length > MAX_BACKUP_BYTES) return Promise.reject(new Error('백업은 272 MiB 이하여야 합니다.'))
  return new Promise((resolve, reject) => {
    fromBuffer(buffer, { lazyEntries: true, autoClose: false, strictFileNames: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) { reject(error ?? new Error('ZIP을 읽을 수 없습니다.')); return }
      let ended = false, total = 0
      const files = new Map<string, Buffer>()
      const fail = (reason: Error) => { if (!ended) { ended = true; zip.close(); reject(reason) } }
      zip.on('error', fail)
      if (zip.entryCount > MAX_STICKERS + 1) { fail(new Error('ZIP 항목 수 제한을 초과했습니다.')); return }
      zip.on('entry', entry => {
        const name = entry.fileName
        const id = /^stickers\/([0-9a-f-]+)\.png$/.exec(name)?.[1]
        const mode = (entry.externalFileAttributes >>> 16) & 0xf000
        const limit = name === 'library.json' ? MAX_MANIFEST_BYTES : MAX_FILE_BYTES
        total += entry.uncompressedSize
        if ((name !== 'library.json' && !validAssetId(id)) || files.has(name)
          || (mode !== 0 && mode !== 0x8000) || (entry.generalPurposeBitFlag & 65)
          || ![0, 8].includes(entry.compressionMethod) || entry.uncompressedSize > limit || total > MAX_LIBRARY_BYTES + MAX_MANIFEST_BYTES) {
          fail(new Error('안전하지 않거나 너무 큰 ZIP 항목입니다.')); return
        }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) { fail(streamError ?? new Error('ZIP 항목 읽기 실패')); return }
          const chunks: Buffer[] = []; let count = 0
          stream.on('data', (chunk: Buffer) => {
            count += chunk.length
            if (count > limit || count > entry.uncompressedSize) { stream.destroy(new Error('ZIP 압축 해제 제한을 초과했습니다.')); return }
            chunks.push(chunk)
          })
          stream.on('error', fail)
          stream.on('end', () => {
            if (ended) return
            const bytes = Buffer.concat(chunks)
            if (count !== entry.uncompressedSize || crc32(bytes) !== entry.crc32) { fail(new Error('ZIP 항목이 손상되었습니다.')); return }
            files.set(name, bytes); zip.readEntry()
          })
        })
      })
      zip.on('end', () => { if (!ended) { ended = true; zip.close(); resolve(files) } })
      zip.readEntry()
    })
  })
}
