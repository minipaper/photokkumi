import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { saveUnique } from '../src/main/files'

const directories: string[] = []
const unsupported = () => { throw Object.assign(new Error('hard links unsupported'), { code: 'ENOTSUP' }) }
async function fixture() {
  const dir = await fs.mkdtemp(join(tmpdir(), 'photokkumi-save-')); directories.push(dir)
  const source = join(dir, '원본 사진.png')
  await fs.writeFile(source, 'source unchanged')
  return { dir, source }
}
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(directories.splice(0).map(path => fs.rm(path, { recursive: true, force: true })))
})
describe('하드 링크 미지원 파일시스템', () => {
  it.each(['ENOTSUP', 'ENOSYS', 'EXDEV', 'EPERM', 'EACCES', 'EOPNOTSUPP'])('%s에서 독점 생성으로 저장한다', async code => {
    const { dir, source } = await fixture()
    vi.spyOn(fs, 'link').mockRejectedValue(Object.assign(new Error('unsupported'), { code }))
    const path = await saveUnique(dir, source, Buffer.from('complete output'))
    expect(await fs.readFile(path, 'utf8')).toBe('complete output')
    expect(await fs.readFile(source, 'utf8')).toBe('source unchanged')
    expect(await fs.readdir(dir)).toEqual(expect.arrayContaining([basename(source), basename(path)]))
    expect((await fs.readdir(dir)).length).toBe(2)
  })
  it('같은 이름을 동시에 저장해도 기존 결과/원본을 보존한다', async () => {
    const { dir, source } = await fixture()
    const existing = join(dir, '원본 사진_kkumi.png'); await fs.writeFile(existing, 'existing')
    vi.spyOn(fs, 'link').mockImplementation(unsupported)
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => saveUnique(dir, source, Buffer.from(`output ${i}`))))
    expect(new Set(results).size).toBe(8)
    for (let i = 0; i < results.length; i++) expect(await fs.readFile(results[i], 'utf8')).toBe(`output ${i}`)
    expect(await fs.readFile(existing, 'utf8')).toBe('existing')
    expect(await fs.readFile(source, 'utf8')).toBe('source unchanged')
    expect((await fs.readdir(dir)).length).toBe(10)
  })
  it('최종 이름을 다른 쓰기 작업이 먼저 차지하면 건드리지 않고 다음 이름을 쓴다', async () => {
    const { dir, source } = await fixture()
    vi.spyOn(fs, 'link').mockImplementation(unsupported)
    const open = fs.open.bind(fs)
    let raced = false
    vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      if (!raced && String(args[0]).endsWith('_kkumi.png')) {
        raced = true; await fs.writeFile(args[0], 'racing writer', { flag: 'wx' })
      }
      return open(...args)
    })
    expect(basename(await saveUnique(dir, source, Buffer.from('ours')))).toBe('원본 사진_kkumi_1.png')
    expect(await fs.readFile(join(dir, '원본 사진_kkumi.png'), 'utf8')).toBe('racing writer')
  })
  it.each(['writeFile', 'sync', 'close'] as const)('최종 파일 %s 실패 시 불완전한 출력과 임시 파일을 지운다', async method => {
    const { dir, source } = await fixture()
    vi.spyOn(fs, 'link').mockImplementation(unsupported)
    const open = fs.open.bind(fs)
    vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await open(...args)
      if (String(args[0]).endsWith('_kkumi.png')) {
        const original = handle[method].bind(handle)
        vi.spyOn(handle, method).mockImplementationOnce(async () => {
          if (method === 'writeFile') await handle.write(Buffer.from('partial'))
          if (method === 'close') await (original as () => Promise<void>)()
          throw Object.assign(new Error('disk failure'), { code: 'EIO' })
        })
      }
      return handle
    })
    await expect(saveUnique(dir, source, Buffer.from('full output'))).rejects.toThrow('disk failure')
    expect(await fs.readdir(dir)).toEqual([basename(source)])
    expect(await fs.readFile(source, 'utf8')).toBe('source unchanged')
  })
  it('일반 I/O 오류는 폴백으로 숨기지 않는다', async () => {
    const { dir, source } = await fixture()
    vi.spyOn(fs, 'link').mockRejectedValue(Object.assign(new Error('I/O failure'), { code: 'EIO' }))
    await expect(saveUnique(dir, source, Buffer.from('data'))).rejects.toThrow('I/O failure')
    expect(await fs.readdir(dir)).toEqual([basename(source)])
  })
})

it('불완전한 파일 삭제의 일시적 Windows 잠금은 재시도한다', async () => {
  const { dir, source } = await fixture()
  vi.spyOn(fs, 'link').mockImplementation(unsupported)
  const open = fs.open.bind(fs)
  vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
    const handle = await open(...args)
    if (String(args[0]).endsWith('_kkumi.png')) {
      handle.writeFile = async () => { await handle.write(Buffer.from('partial')); throw new Error('write failed') }
    }
    return handle
  })
  const unlink = fs.unlink.bind(fs)
  let locked = true
  vi.spyOn(fs, 'unlink').mockImplementation(async path => {
    if (locked && String(path).endsWith('_kkumi.png')) {
      locked = false; throw Object.assign(new Error('locked'), { code: 'EPERM' })
    }
    return unlink(path)
  })
  await expect(saveUnique(dir, source, Buffer.from('data'))).rejects.toThrow('write failed')
  expect(locked).toBe(false)
  expect(await fs.readdir(dir)).toEqual([basename(source)])
})
it('다른 프로세스가 실패한 파일을 교체하면 타인의 파일을 지우지 않는다', async () => {
  const { dir, source } = await fixture()
  vi.spyOn(fs, 'link').mockImplementation(unsupported)
  const open = fs.open.bind(fs)
  vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
    const handle = await open(...args)
    if (String(args[0]).endsWith('_kkumi.png')) {
      handle.writeFile = async () => {
        // Closing before replacement also exercises the Windows rename/delete rules.
        await handle.close()
        await fs.rename(args[0], join(dir, 'moved-partial'))
        await fs.writeFile(args[0], 'someone else', { flag: 'wx' })
        throw new Error('write failed')
      }
    }
    return handle
  })
  await expect(saveUnique(dir, source, Buffer.from('data'))).rejects.toThrow('출력 파일이 바뀌어')
  expect(await fs.readFile(join(dir, '원본 사진_kkumi.png'), 'utf8')).toBe('someone else')
})
it('OS가 삭제를 계속 거부하면 정리 실패를 명시적으로 반환한다', async () => {
  const { dir, source } = await fixture()
  vi.spyOn(fs, 'link').mockImplementation(unsupported)
  const open = fs.open.bind(fs)
  vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
    const handle = await open(...args)
    if (String(args[0]).endsWith('_kkumi.png')) handle.writeFile = async () => { throw new Error('write failed') }
    return handle
  })
  const unlink = fs.unlink.bind(fs)
  vi.spyOn(fs, 'unlink').mockImplementation(async path => {
    if (String(path).endsWith('_kkumi.png')) throw Object.assign(new Error('denied'), { code: 'EACCES' })
    return unlink(path)
  })
  await expect(saveUnique(dir, source, Buffer.from('data'))).rejects.toThrow('파일 정리를 마치지 못했습니다: 원본 사진_kkumi.png')
  expect((await fs.readdir(dir)).filter(name => name.endsWith('.tmp'))).toEqual([])
  expect(await fs.readFile(source, 'utf8')).toBe('source unchanged')
})
