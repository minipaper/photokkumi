import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { PNG } from 'pngjs'
import jpeg from 'jpeg-js'

let app: ElectronApplication
let page: Page
let directory: string
let source: string
let stickerPath: string
const errors: string[] = []
function makePng(width: number, height: number, pixel: (x: number, y: number) => number[]) {
  const image = new PNG({ width, height })
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) image.data.set(pixel(x, y), (y * width + x) * 4)
  return PNG.sync.write(image)
}
async function select(path: string | null) {
  await app.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({ canceled: selected === null, filePaths: selected ? [selected] : [] })
  }, path)
}
async function field(name: string, value: number) { await page.getByRole('spinbutton', { name, exact: true }).fill(String(value)) }
async function value(name: string) { return Number(await page.getByRole('spinbutton', { name, exact: true }).inputValue()) }
async function output(name = '한글 사진_kkumi.png') { return PNG.sync.read(await readFile(join(directory, name))) }
function pixel(image: PNG, x: number, y: number) { return [...image.data.subarray((image.width * y + x) * 4, (image.width * y + x) * 4 + 4)] }
async function save() {
  await select(directory)
  await page.getByRole('button', { name: 'PNG로 저장' }).click()
  await expect(page.getByRole('status')).toContainText('저장 완료')
}
async function load() {
  await select(source); await page.getByRole('button', { name: '사진 열기', exact: true }).click()
  await expect(page.getByRole('button', { name: 'PNG 스티커 열기' })).toBeEnabled()
  await select(stickerPath); await page.getByRole('button', { name: 'PNG 스티커 열기' }).click()
  await expect(page.getByRole('spinbutton', { name: '스티커 너비' })).toBeVisible()
}

test.beforeEach(async () => {
  errors.length = 0
  directory = await mkdtemp(join(tmpdir(), 'photokkumi-e2e-'))
  source = join(directory, '한글 사진.png'); stickerPath = join(directory, '투명 스티커.png')
  await writeFile(source, makePng(1200, 800, () => [20, 40, 200, 255]))
  await writeFile(stickerPath, makePng(80, 40, (x, y) => y >= 30 ? [0, 0, 0, 0] : x < 40 ? [255, 0, 0, 255] : [0, 255, 0, 255]))
  const factor = test.info().project.metadata.deviceScaleFactor
  const scaleArgs = typeof factor === 'number' ? [`--force-device-scale-factor=${factor}`] : []
  app = await electron.launch({ args: [resolve('out/main/index.js'), `--user-data-dir=${join(directory, 'profile')}`, ...scaleArgs], env: { ...process.env, ELECTRON_RENDERER_URL: '' } })
  page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await expect(page.getByRole('heading', { name: '포토꾸미', exact: true })).toBeVisible()
  if (typeof factor === 'number') expect(await page.evaluate(() => window.devicePixelRatio)).toBe(factor)
  await app.context().setOffline(true)
})
test.afterEach(async () => {
  if (app) {
    if (page && !page.isClosed()) await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy()))
    await app.close().catch(error => { if (!page?.isClosed()) throw error })
  }
  if (directory) await rm(directory, { recursive: true, force: true })
  expect(errors).toEqual([])
})

test('실제 마우스 이동·비율 유지 크기·회전 핸들, 원본 좌표 합성과 SHA-256', async () => {
  const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
  const original = hash(await readFile(source)); const stickerHash = hash(await readFile(stickerPath))
  await load()
  const frame = page.getByTestId('canvas-frame')
  const box = (await frame.boundingBox())!
  const scale = Number(await frame.getAttribute('data-scale'))
  expect(scale).toBeLessThan(1)
  const drag = async (x: number, y: number, dx: number, dy: number) => {
    await page.mouse.move(box.x + x * scale, box.y + y * scale)
    await page.mouse.down()
    await page.mouse.move(box.x + (x + dx) * scale, box.y + (y + dy) * scale, { steps: 12 })
    await page.mouse.up()
  }
  await drag(580, 390, 80, 40)
  await expect.poll(async () => Math.abs(await value('중심 X') - 680)).toBeLessThan(2 / scale)
  await expect.poll(async () => Math.abs(await value('중심 Y') - 440)).toBeLessThan(2 / scale)
  await drag(await value('중심 X') + 40, await value('중심 Y') + 20, 40, 20)
  expect(await value('스티커 너비')).toBeGreaterThan(100)
  // Rotation handle is 50 CSS pixels above the top edge.
  const cx = await value('중심 X'); const cy = await value('중심 Y'); const width = await value('스티커 너비')
  const radius = width / 4 * scale + 50
  await page.mouse.move(box.x + cx * scale, box.y + cy * scale - radius)
  await page.mouse.down()
  await page.mouse.move(box.x + cx * scale + radius, box.y + cy * scale, { steps: 15 })
  await page.mouse.up()
  expect(Math.abs(await value('회전'))).toBeGreaterThan(40)

  await field('중심 X', 400); await field('중심 Y', 300); await field('스티커 너비', 160); await field('회전', 90)
  // Read only the photo/sticker layer, excluding Transformer UI. Include a border
  // location so sampling the overlay again cannot silently pass this regression.
  const samples = [[420, 270], [420, 330], [370, 300], [20, 20], [360, 300]]
  const readPreview = () => page.getByTestId('photo-content').evaluate((element, points) => {
    const canvas = element as HTMLCanvasElement
    const ctx = canvas.getContext('2d')!
    const ratioX = canvas.width / 1200
    const ratioY = canvas.height / 800
    return points.map(([x, y]) => [...ctx.getImageData(Math.floor(x * ratioX), Math.floor(y * ratioY), 1, 1).data])
  }, samples)
  await save()
  const image = await output()
  expect([image.width, image.height]).toEqual([1200, 800])
  expect(pixel(image, 420, 270)).toEqual([255, 0, 0, 255])
  expect(pixel(image, 420, 330)).toEqual([0, 255, 0, 255])
  expect(pixel(image, 370, 300)).toEqual([20, 40, 200, 255])
  expect(pixel(image, 360, 300)).toEqual([20, 40, 200, 255])
  // Input action completion does not mean Konva's next animation frame has painted.
  await expect.poll(readPreview).toEqual(samples.map(([x, y]) => pixel(image, x, y)))
  expect(hash(await readFile(source))).toBe(original)
  expect(hash(await readFile(stickerPath))).toBe(stickerHash)
  await page.screenshot({ path: 'test-results/stage-a-editor.png' })
  // Clip the portion outside the photo and keep existing output intact.
  const first = await readFile(join(directory, '한글 사진_kkumi.png'))
  await field('회전', 0); await field('중심 X', 0); await field('중심 Y', 0)
  await save()
  const clipped = await output('한글 사진_kkumi_1.png')
  expect(pixel(clipped, 20, 5)).toEqual([0, 255, 0, 255])
  expect(pixel(clipped, 100, 5)).toEqual([20, 40, 200, 255])
  expect(await readFile(join(directory, '한글 사진_kkumi.png'))).toEqual(first)
})

test('저장 실패·취소와 스티커 선택 취소가 편집을 보존하고 재시도된다', async () => {
  await load(); await field('회전', 35)
  await select(null); await page.getByRole('button', { name: 'PNG 스티커 열기' }).click()
  await expect(page.getByRole('spinbutton', { name: '회전', exact: true })).toHaveValue('35')
  await select(null); await page.getByRole('button', { name: 'PNG로 저장' }).click()
  await expect(page.getByRole('status')).toContainText('취소')
  expect((await readdir(directory)).filter(x => x.includes('_kkumi'))).toEqual([])
  await select(join(directory, 'missing', 'directory'))
  await page.getByRole('button', { name: 'PNG로 저장' }).click()
  await expect(page.getByRole('alert')).toContainText('저장하지 못했습니다')
  await expect(page.getByRole('spinbutton', { name: '회전', exact: true })).toHaveValue('35')
  await save()
  await field('회전', 50)
  await expect(page.getByRole('status')).toContainText('수정됨')
})

test('안전한 창 설정·IPC 거부·잘못된 이미지 거부', async () => {
  const prefs = await app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents as unknown as { getLastWebPreferences(): { sandbox: boolean; contextIsolation: boolean; nodeIntegration: boolean } }
    const p = contents.getLastWebPreferences()
    return { sandbox: p.sandbox, contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration }
  })
  expect(prefs).toEqual({ sandbox: true, contextIsolation: true, nodeIntegration: false })
  expect(await page.evaluate(() => Object.keys(window.photokkumi).sort())).toEqual(['choosePhoto', 'chooseSticker', 'onCloseRequested', 'resolveClose', 'savePng'])
  expect(await page.evaluate(() => typeof (window as unknown as { require?: unknown }).require)).toBe('undefined')
  const invalid = await page.evaluate(() => window.photokkumi.savePng({ photoId: '../../anything', png: new Uint8Array() }))
  expect(invalid.ok).toBe(false)
  expect((await page.evaluate(() => window.photokkumi.resolveClose({ requestId: 'forged', action: 'close' }))).ok).toBe(false)
  const corrupt = join(directory, 'corrupt.png'); await writeFile(corrupt, '<svg/>')
  await select(corrupt); await page.getByRole('button', { name: '사진 열기', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('button', { name: '사진 열기', exact: true })).toBeEnabled()
  await load()
  const rejected = await page.evaluate(() => window.photokkumi.savePng({ photoId: '00000000-0000-0000-0000-000000000000', png: new Uint8Array([137]) }))
  expect(rejected.ok).toBe(false)
  expect(await app.evaluate(async ({ net }) => (await net.fetch('app://bundle/../../package.json')).status)).toBe(403)
})

test('EXIF 회전 JPG를 한 번만 회전하고 메타데이터 없이 저장한다', async () => {
  const image = new PNG({ width: 60, height: 40 })
  for (let y = 0; y < 40; y++) for (let x = 0; x < 60; x++) image.data.set(x < 30 ? [255, 0, 0, 255] : [0, 255, 0, 255], (y * 60 + x) * 4)
  const encoded = jpeg.encode(image, 100).data
  // Minimal TIFF IFD with orientation=6 (90° clockwise).
  const exif = Buffer.from('45786966000049492a0008000000010012010300010000000600000000000000', 'hex')
  const header = Buffer.alloc(4); header[0] = 255; header[1] = 225; header.writeUInt16BE(exif.length + 2, 2)
  source = join(directory, '방향.jpg')
  await writeFile(source, Buffer.concat([encoded.subarray(0, 2), header, exif, encoded.subarray(2)]))
  await select(source); await page.getByRole('button', { name: '사진 열기', exact: true }).click()
  await expect(page.getByRole('button', { name: 'PNG로 저장' })).toBeEnabled()
  await save()
  const result = await output('방향_kkumi.png')
  expect([result.width, result.height]).toEqual([40, 60])
  expect(pixel(result, 20, 10)[0]).toBeGreaterThan(245)
  expect(pixel(result, 20, 50)[1]).toBeGreaterThan(245)
  const bytes = await readFile(join(directory, '방향_kkumi.png'))
  expect(bytes.includes(Buffer.from('eXIf'))).toBe(false)
  expect(bytes.includes(Buffer.from('Exif'))).toBe(false)
})

async function requestClose(quit = false) {
  await app.evaluate(({ BrowserWindow, app }, shouldQuit) => {
    setTimeout(() => { if (shouldQuit) app.quit(); else BrowserWindow.getAllWindows()[0]?.close() }, 0)
  }, quit)
}
test('미저장 닫기: 취소와 저장 취소·실패 시 편집 유지, 저장 성공 후에만 닫기', async () => {
  await load(); await field('회전', 35)
  await requestClose()
  const dialog = page.getByRole('dialog', { name: '저장하지 않은 편집' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '취소', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole('spinbutton', { name: '회전', exact: true })).toHaveValue('35')
  await requestClose(); await select(null)
  await dialog.getByRole('button', { name: '저장', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('취소')
  await expect(dialog).not.toBeVisible()
  expect(page.isClosed()).toBe(false)
  await requestClose(); await select(join(directory, 'missing', 'folder'))
  await dialog.getByRole('button', { name: '저장', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('저장하지 못했습니다')
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole('spinbutton', { name: '회전', exact: true })).toHaveValue('35')
  await requestClose(); await select(directory)
  const closed = page.waitForEvent('close')
  await dialog.getByRole('button', { name: '저장', exact: true }).click()
  await closed
  expect((await output()).width).toBe(1200)
})
test('앱 종료 요청: 취소는 종료를 취소하고 버리기는 파일을 만들지 않고 닫는다', async () => {
  await load(); await field('회전', 20)
  await requestClose(true)
  const dialog = page.getByRole('dialog', { name: '저장하지 않은 편집' })
  await expect(dialog).toBeVisible()
  // Repeated OS close/quit requests must not create overlapping dialogs.
  await requestClose(true)
  await dialog.getByRole('button', { name: '취소', exact: true }).click()
  expect(page.isClosed()).toBe(false)
  await expect(page.getByRole('spinbutton', { name: '회전', exact: true })).toHaveValue('20')
  await requestClose()
  const closed = page.waitForEvent('close')
  await dialog.getByRole('button', { name: '버리기', exact: true }).click()
  await closed
  expect((await readdir(directory)).filter(x => x.includes('_kkumi'))).toEqual([])
})

test('하드 링크 미지원 + 중간 쓰기 실패는 출력 정리와 편집을 유지하고 재시도된다', async () => {
  await load(); await field('회전', 25)
  await app.evaluate(async () => {
    const fs = process.getBuiltinModule('node:fs/promises') as typeof import('node:fs/promises')
    fs.link = async () => { throw Object.assign(new Error('unsupported'), { code: 'ENOTSUP' }) }
    const open = fs.open.bind(fs)
    let failOnce = true
    fs.open = async (...args: Parameters<typeof fs.open>) => {
      const handle = await open(...args)
      if (failOnce && String(args[0]).endsWith('_kkumi.png')) {
        failOnce = false
        handle.writeFile = async () => { await handle.write(Buffer.from('partial')); throw new Error('disk failure') }
      }
      return handle
    }
  })
  await select(directory); await page.getByRole('button', { name: 'PNG로 저장' }).click()
  await expect(page.getByRole('alert')).toContainText('저장하지 못했습니다')
  expect((await readdir(directory)).filter(x => x.includes('_kkumi') || x.endsWith('.tmp'))).toEqual([])
  await expect(page.getByRole('spinbutton', { name: '회전', exact: true })).toHaveValue('25')
  await save()
  expect((await output()).width).toBe(1200)
})
test('저장된 편집은 확인 없이 닫고, 저장 중 닫기는 작업이 끝날 때까지 보류한다', async () => {
  await load(); await field('회전', 40)
  await app.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = () => new Promise(resolve => {
      setTimeout(() => resolve({ canceled: true, filePaths: [selected] }), 500)
    })
  }, directory)
  await page.getByRole('button', { name: 'PNG로 저장' }).click()
  await expect(page.getByRole('button', { name: '처리 중…' })).toBeVisible()
  await requestClose()
  expect(page.isClosed()).toBe(false)
  const dialog = page.getByRole('dialog', { name: '저장하지 않은 편집' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '취소', exact: true }).click()
  await expect(page.getByRole('spinbutton', { name: '회전', exact: true })).toHaveValue('40')
  await save()
  const closed = page.waitForEvent('close')
  await requestClose()
  await closed
})

test('앱 종료 메뉴 요청에서 버리기를 선택하면 프로세스까지 종료한다', async () => {
  await load()
  await requestClose(true)
  const dialog = page.getByRole('dialog', { name: '저장하지 않은 편집' })
  await expect(dialog).toBeVisible()
  const closed = app.waitForEvent('close')
  await dialog.getByRole('button', { name: '버리기', exact: true }).click()
  await closed
})
