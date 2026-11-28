import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { setTimeout } from 'node:timers/promises'

const LINK_UNAVAILABLE = new Set(['ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV', 'EPERM', 'EACCES'])
export class SaveCleanupError extends Error {}
function errorCode(error: unknown) { return (error as NodeJS.ErrnoException).code }
async function removeFile(path: string) {
  for (let attempt = 0; ; attempt++) {
    try { await fs.unlink(path); return }
    catch (error) {
      if (errorCode(error) === 'ENOENT') return
      if (attempt < 2 && ['EPERM', 'EBUSY'].includes(errorCode(error) ?? '')) { await setTimeout(50); continue }
      throw new SaveCleanupError(`파일 정리를 마치지 못했습니다: ${basename(path)}. 폴더를 확인한 뒤 다시 저장하세요.`)
    }
  }
}
async function writeExclusive(destination: string, bytes: Uint8Array) {
  // Keep open outside the cleanup block: an EEXIST file belongs to somebody else.
  const handle = await fs.open(destination, 'wx', 0o600)
  let identity: Awaited<ReturnType<typeof handle.stat>> | undefined
  try {
    identity = await handle.stat()
    await handle.writeFile(bytes)
    if ((await handle.stat()).size !== bytes.byteLength) throw new Error('출력 파일 크기를 확인할 수 없습니다.')
    await handle.sync()
    await handle.close()
  } catch (error) {
    await handle.close().catch(() => undefined)
    const current = await fs.lstat(destination).catch(failure => {
      if (errorCode(failure) === 'ENOENT') return undefined
      throw new SaveCleanupError(`불완전한 출력 확인에 실패했습니다: ${basename(destination)}`)
    })
    if (current) {
      // Do not remove a file replaced by another writer after our exclusive open.
      if (!identity || current.dev !== identity.dev || current.ino !== identity.ino) {
        throw new SaveCleanupError(`출력 파일이 바뀌어 자동 정리하지 않았습니다: ${basename(destination)}`)
      }
      await removeFile(destination)
    }
    throw error
  }
}

export async function saveUnique(directory: string, source: string, bytes: Uint8Array, extension: '.png' | '.jpg' | '.zip' | '.gif' = '.png', suffix = '_kkumi'): Promise<string> {
  const temporary = join(directory, `.${randomUUID()}.tmp`)
  await writeExclusive(temporary, bytes)
  // Portable no-overwrite fallback. A partial name is visible until fsync/close.
  try { return await claimName(directory, source, extension, suffix, temporary, destination => writeExclusive(destination, bytes)) }
  finally { await removeFile(temporary) }
}
/**
 * Like saveUnique for outputs too large to hold in memory (MP4): `temporary` is a finished file that ffmpeg
 * wrote inside `directory`. It gets the first free `<stem>_kkumi[_n].mp4` name and is removed in every case.
 */
export async function publishUnique(directory: string, source: string, temporary: string, extension: '.mp4', suffix = '_kkumi'): Promise<string> {
  try { return await claimName(directory, source, extension, suffix, temporary, async destination => {
    try { await fs.copyFile(temporary, destination, fs.constants.COPYFILE_EXCL) }
    catch (error) {
      // EXCL: a destination left behind by any other failure is our partial copy.
      if (errorCode(error) !== 'EEXIST') await fs.unlink(destination).catch(() => undefined)
      throw error
    }
  }) }
  finally { await removeFile(temporary) }
}
/** First free name for the finished temporary file: a hard link (atomic, no overwrite), else `fallback` (must fail with EEXIST). */
async function claimName(directory: string, source: string, extension: string, suffix: string, temporary: string, fallback: (destination: string) => Promise<void>) {
  // Control characters must be removed from Windows filenames.
  // eslint-disable-next-line no-control-regex
  const stem = basename(source, extname(source)).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100) || 'photo'
  let canLink = true
  for (let i = 0; i < 10_000; i++) {
    const destination = join(directory, `${stem}${suffix}${i ? `_${i}` : ''}${extension}`)
    try {
      if (canLink) {
        try { await fs.link(temporary, destination); return destination }
        catch (error) {
          if (!LINK_UNAVAILABLE.has(errorCode(error) ?? '')) throw error
          canLink = false
        }
      }
      await fallback(destination)
      return destination
    } catch (error) { if (errorCode(error) !== 'EEXIST') throw error }
  }
  throw new Error('사용 가능한 파일 이름이 없습니다.')
}
