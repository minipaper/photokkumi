import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fitScale, validPlacement } from '../src/shared/model'
import { inspectImage, MAX_PIXELS, MAX_FILE_BYTES } from '../src/main/images'
import { saveUnique } from '../src/main/files'
import { PNG } from 'pngjs'

function png(width = 16, height = 8) {
  return PNG.sync.write(new PNG({ width, height }))
}
describe('원본 좌표와 입력 경계', () => {
  it('보기 크기만 바꾸고 원본 좌표를 유지한다', () => {
    expect(fitScale(4000, 3000, 800, 600)).toBe(.2)
    expect(fitScale(400, 300, 800, 600)).toBe(1)
    expect(validPlacement({ x: -10, y: 20, width: 40, height: 20, rotation: 90 })).toBe(true)
    for (const value of [NaN, Infinity, 0, -1]) {
      expect(validPlacement({ x: 0, y: 0, width: value, height: 20, rotation: 0 })).toBe(false)
    }
  })
  it('실제 PNG 헤더와 픽셀/파일 크기 제한을 검증한다', () => {
    expect(inspectImage(png(), 'sticker')).toMatchObject({ width: 16, height: 8, mime: 'image/png' })
    expect(() => inspectImage(Buffer.from('<svg/>'), 'photo')).toThrow()
    const large = png(); large.writeUInt32BE(MAX_PIXELS, 16)
    expect(() => inspectImage(large, 'photo')).toThrow()
    expect(() => inspectImage(Buffer.alloc(MAX_FILE_BYTES + 1), 'photo')).toThrow()
  })
})
describe('원본과 기존 파일을 보존하는 저장', () => {
  it('동시 충돌에도 별도 이름으로 저장하고 임시 파일을 정리한다', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'photokkumi-'))
    try {
      const source = join(dir, '한글 사진.png')
      await writeFile(source, png())
      const before = await readFile(source)
      const names = await Promise.all(Array.from({ length: 4 }, () => saveUnique(dir, source, png())))
      expect(new Set(names).size).toBe(4)
      expect(await readFile(source)).toEqual(before)
      expect((await readdir(dir)).filter(x => x.endsWith('.tmp'))).toEqual([])
      const content = await readFile(names[0]); expect(content).toEqual(png())
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
  it('쓰기 실패를 호출자에게 전달한다', async () => {
    await expect(saveUnique(join(tmpdir(), 'missing-photokkumi', 'missing'), 'source.png', png())).rejects.toThrow()
  })
})
