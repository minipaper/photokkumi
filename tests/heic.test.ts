import { it, expect } from 'vitest'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { fitPixels, isHeic, withIccProfile } from '../src/main/heic'
import { decodeHeic } from '../src/main/heic-decode'
import { PhotoStore } from '../src/main/photos'

const fixture = (name: string) => readFile(join(__dirname, 'fixtures', name))
const ftyp = (major: string, ...compatible: string[]) => {
  const bytes = Buffer.alloc(16 + compatible.length * 4)
  bytes.writeUInt32BE(bytes.length, 0); bytes.write('ftyp', 4, 'latin1'); bytes.write(major, 8, 'latin1')
  compatible.forEach((brand, index) => bytes.write(brand, 16 + index * 4, 'latin1'))
  return bytes
}

it('HEIC는 ftyp 상자의 HEVC 브랜드로 알아보고 AVIF·PNG·짧은 파일은 받지 않는다', async () => {
  expect(isHeic(await fixture('quad-srgb.heic'))).toBe(true)
  expect(isHeic(ftyp('mif1', 'MiPr', 'heic'))).toBe(true)
  expect(isHeic(ftyp('heix'))).toBe(true)
  expect(isHeic(ftyp('avif', 'mif1', 'miaf'))).toBe(false)
  expect(isHeic(ftyp('mif1', 'avif'))).toBe(false)
  expect(isHeic(PNG.sync.write(new PNG({ width: 2, height: 2 })))).toBe(false)
  expect(isHeic(Buffer.from('ftypheic'))).toBe(false)
})

it('큰 사진은 같은 모양으로 1,600만 화소·한 변 8192px 안에 맞추고 작은 사진은 그대로 둔다', () => {
  const iphone = fitPixels(5712, 4284, 16_000_000, 8192)
  expect(iphone).toEqual({ width: 4618, height: 3464 })
  expect(iphone.width * iphone.height).toBeLessThanOrEqual(16_000_000)
  expect(fitPixels(4032, 3024, 16_000_000, 8192)).toEqual({ width: 4032, height: 3024 })
  expect(fitPixels(12000, 1000, 16_000_000, 8192)).toEqual({ width: 8192, height: 682 })
})

it('ICC 프로필을 JFIF 뒤 APP2 ICC_PROFILE 조각으로 넣는다', () => {
  const jfif = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xdb, 0x00, 0x02, 0xff, 0xd9])
  const small = withIccProfile(jfif, Buffer.alloc(100, 7))
  expect([...small.subarray(0, 8)]).toEqual([...jfif.subarray(0, 8)])
  expect(small.readUInt16BE(8)).toBe(0xffe2)
  expect(small.readUInt16BE(10)).toBe(116)
  expect(small.toString('latin1', 12, 24)).toBe('ICC_PROFILE\0')
  expect([small[24], small[25], small[26]]).toEqual([1, 1, 7])
  expect(small.subarray(-6)).toEqual(jfif.subarray(8))
  const large = withIccProfile(jfif, Buffer.alloc(70_000, 1))
  const second = 8 + 4 + 65535 - 2 + 0
  expect(large.readUInt16BE(10)).toBe(65535)
  expect(large.readUInt16BE(second)).toBe(0xffe2)
  expect([large[second + 16], large[second + 17]]).toEqual([2, 2])
  expect(large.length).toBe(jfif.length + 70_000 + 2 * 18)
  expect(withIccProfile(jfif)).toBe(jfif)
  const png = PNG.sync.write(new PNG({ width: 1, height: 1 }))
  expect(withIccProfile(png, Buffer.alloc(10))).toBe(png)
})

it('libheif로 합성 HEIC를 BGRA로 풀고 Display P3 프로필을 꺼낸다', async () => {
  const srgb = await decodeHeic(await fixture('quad-srgb.heic'))
  expect([srgb.width, srgb.height, srgb.alpha, srgb.icc]).toEqual([96, 64, false, undefined])
  const pixel = (x: number, y: number) => [...srgb.pixels.subarray((y * 96 + x) * 4, (y * 96 + x) * 4 + 4)]
  const near = (actual: number[], expected: number[]) => actual.forEach((value, index) => expect(Math.abs(value - expected[index])).toBeLessThanOrEqual(6))
  near(pixel(10, 10), [60, 60, 200, 255]) // red quadrant, stored as B G R A
  near(pixel(80, 10), [60, 180, 60, 255])
  near(pixel(10, 50), [200, 60, 60, 255])
  near(pixel(80, 50), [128, 128, 128, 255])
  const p3 = await decodeHeic(await fixture('quad-p3.heic'))
  expect(p3.icc?.length).toBe(536)
  expect(Buffer.from(p3.icc!).toString('latin1', 36, 40)).toBe('acsp')
  const big = await decodeHeic(await fixture('quad-24mp.heic'))
  expect([big.width, big.height, big.pixels.length]).toEqual([5712, 4284, 5712 * 4284 * 4])
  await expect(decodeHeic(ftyp('heic', 'mif1'))).rejects.toThrow('HEIC')
})

it('HEIC 사진은 변환본을 캐시 폴더에 두고 읽기·제거·변환 실패·캐시 분실을 처리한다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'photokkumi-heic-'))
  try {
    const cache = join(dir, 'converted'), path = join(dir, 'IMG_0001.HEIC'), broken = join(dir, 'broken.heic')
    const heic = await fixture('quad-srgb.heic')
    await writeFile(path, heic); await writeFile(broken, ftyp('heic'))
    const converted = PNG.sync.write(new PNG({ width: 96, height: 64 }))
    let calls = 0
    const store = new PhotoStore(() => 'thumb', { directory: cache, convert: async bytes => {
      calls++
      if (bytes.length < 100) throw new Error('decode failed')
      return converted
    } })
    const progress: number[][] = []
    store.onProgress = (done, total) => progress.push([done, total])
    const rejected: string[] = []
    const [photo] = await store.add([path, broken], rejected)
    expect(rejected).toEqual(['broken.heic'])
    expect(progress).toEqual([[1, 2]])
    expect(photo).toMatchObject({ name: 'IMG_0001.HEIC', width: 96, height: 64, mime: 'image/png' })
    expect(await readdir(cache)).toHaveLength(1)
    expect((await store.read(photo.id)).bytes).toEqual(converted)
    await rm(cache, { recursive: true })
    expect((await store.read(photo.id)).bytes).toEqual(converted)
    expect(calls).toBe(3)
    store.remove(photo.id)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(await readdir(cache)).toEqual([])
    await expect(new PhotoStore(() => 'thumb').add([path])).rejects.toThrow('HEIC')
  } finally { await rm(dir, { recursive: true, force: true }) }
})
