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
async function select(path: string | string[] | null) {
  await app.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({ canceled: selected === null, filePaths: selected ? (Array.isArray(selected) ? selected : [selected]) : [] })
  }, path)
}
async function settings() {
  const toggle = page.getByRole('button', { name: /^저장 설정/ })
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
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
async function openManager() {
  await page.getByRole('button', { name: '스티커 관리', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '스티커 관리', exact: true })).toBeVisible()
}
async function closeManager() {
  await page.getByRole('button', { name: '관리 닫기', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '스티커 관리', exact: true })).not.toBeVisible()
}
async function register(paths: string | string[] | null) {
  await select(paths); await openManager()
  await page.getByRole('button', { name: 'PNG 등록', exact: true }).click()
  await expect(page.getByRole('button', { name: 'PNG 등록', exact: true })).toBeEnabled()
  await closeManager()
}
async function load() {
  await select(source); await page.getByRole('button', { name: '사진 열기', exact: true }).click()
  await expect(page.getByRole('button', { name: 'PNG로 저장' })).toBeEnabled()
  await register(stickerPath)
  await page.getByRole('button', { name: '투명 스티커 배치', exact: true }).click()
  await expect(page.getByRole('spinbutton', { name: '스티커 너비' })).toBeVisible()
}
async function failNextOutput() {
  await app.evaluate(() => {
    const fs = process.getBuiltinModule('node:fs/promises') as typeof import('node:fs/promises')
    const link = fs.link.bind(fs)
    let fail = true
    fs.link = async (...args: Parameters<typeof fs.link>) => {
      if (fail && /_kkumi(?:_\d+)?\.(png|jpg)$/.test(String(args[1]))) { fail = false; throw Object.assign(new Error('output denied'), { code: 'EIO' }) }
      return link(...args)
    }
  })
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
  await register(null)
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
  expect(await page.evaluate(() => Object.keys(window.photokkumi).sort())).toEqual(['backupLibrary', 'cancelGif', 'chooseGifTool', 'chooseOutputFolder', 'choosePhotoFolder', 'choosePhotos', 'createGif', 'deleteSticker', 'getOutputSettings', 'gifToolStatus', 'importDroppedFiles', 'importStickers', 'listStickers', 'loadVideo', 'locateGifTool', 'onCloseRequested', 'onGifProgress', 'openVideo', 'readPhoto', 'removePhoto', 'resolveClose', 'restoreLibrary', 'saveImage', 'setStickerReferences', 'updateOutputSettings', 'updateSticker', 'useSticker'])
  expect(await page.evaluate(() => typeof (window as unknown as { require?: unknown }).require)).toBe('undefined')
  const invalid = await page.evaluate(() => window.photokkumi.saveImage({ photoId: '../../anything', png: new Uint8Array(), output: { format: 'png', resizeEnabled: false, resizeBasis: 'width', landscapeSize: 1600, portraitSize: 900, preventUpscale: true, quality: 100 } }))
  expect(invalid.ok).toBe(false)
  expect((await page.evaluate(() => window.photokkumi.resolveClose({ requestId: 'forged', action: 'close' }))).ok).toBe(false)
  expect((await page.evaluate(() => window.photokkumi.importDroppedFiles([new File(['x'], '/etc/passwd')]))).ok).toBe(false)
  expect((await page.evaluate(() => window.photokkumi.removePhoto('../../anything'))).ok).toBe(false)
  expect((await page.evaluate(() => window.photokkumi.loadVideo('../../etc/passwd'))).ok).toBe(false)
  expect((await page.evaluate(() => window.photokkumi.loadVideo('00000000-0000-4000-8000-000000000000'))).ok).toBe(false)
  expect((await page.evaluate(() => window.photokkumi.createGif('00000000-0000-4000-8000-000000000000', { start: 0, end: 1, width: 480, fps: 12 }))).ok).toBe(false)
  expect((await page.evaluate(() => window.photokkumi.createGif('00000000-0000-4000-8000-000000000000', { start: 0, end: 1, width: 4800, fps: 12 }))).ok).toBe(false)
  expect((await page.evaluate(() => window.photokkumi.removePhoto('00000000-0000-4000-8000-000000000000'))).ok).toBe(false)
  const corrupt = join(directory, 'corrupt.png'); await writeFile(corrupt, '<svg/>')
  await select(corrupt); await page.getByRole('button', { name: '사진 열기', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('button', { name: '사진 열기', exact: true })).toBeEnabled()
  await load()
  const rejected = await page.evaluate(() => window.photokkumi.saveImage({ photoId: '00000000-0000-0000-0000-000000000000', png: new Uint8Array([137]), output: { format: 'png', resizeEnabled: false, resizeBasis: 'width', landscapeSize: 1600, portraitSize: 900, preventUpscale: true, quality: 100 } }))
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
  await expect.poll(() => page.locator('.photo-item img').evaluate(image => [(image as HTMLImageElement).naturalWidth, (image as HTMLImageElement).naturalHeight])).toEqual([40, 60])
  await save()
  const result = await output('방향_kkumi.png')
  expect([result.width, result.height]).toEqual([40, 60])
  expect(pixel(result, 20, 10)[0]).toBeGreaterThan(245)
  expect(pixel(result, 20, 50)[1]).toBeGreaterThan(245)
  const bytes = await readFile(join(directory, '방향_kkumi.png'))
  expect(bytes.includes(Buffer.from('eXIf'))).toBe(false)
  expect(bytes.includes(Buffer.from('Exif'))).toBe(false)
  await settings(); await page.getByRole('combobox', { name: '출력 형식', exact: true }).selectOption('jpg')
  await settings(); await page.getByRole('checkbox', { name: '블로그 크기로 리사이즈', exact: true }).check()
  await settings(); await field('세로 사진 길이', 20)
  await select(directory); await page.getByRole('button', { name: 'JPG로 저장' }).click()
  await expect(page.getByRole('status')).toContainText('저장 완료')
  const jpgBytes = await readFile(join(directory, '방향_kkumi.jpg'))
  const resized = jpeg.decode(jpgBytes)
  expect([resized.width, resized.height]).toEqual([20, 30])
  expect(pixel(resized as unknown as PNG, 10, 5)[0]).toBeGreaterThan(230)
  expect(pixel(resized as unknown as PNG, 10, 25)[1]).toBeGreaterThan(230)
  expect(jpgBytes.includes(Buffer.from('Exif'))).toBe(false)
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

async function restartWithLibrary() {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy()))
  await app.close().catch(error => { if (!page.isClosed()) throw error })
  app = await electron.launch({ args: [resolve('out/main/index.js'), `--user-data-dir=${join(directory, 'profile')}`], env: { ...process.env, ELECTRON_RENDERER_URL: '' } })
  page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await expect(page.getByRole('heading', { name: '포토꾸미', exact: true })).toBeVisible()
  await app.context().setOffline(true)
}
test('라이브러리 다중 등록·중복·메타데이터·원본 이동·재시작·클릭 배치·삭제 보호', async () => {
  const second = join(directory, '다른 스티커.png')
  await writeFile(second, makePng(40, 40, () => [100, 100, 0, 255]))
  await openManager()
  await select([stickerPath, second, stickerPath])
  await page.getByRole('button', { name: 'PNG 등록', exact: true }).click()
  await expect(page.getByRole('img', { name: '투명 스티커', exact: true })).toBeVisible()
  await expect(page.getByRole('article')).toHaveCount(2)
  await page.getByRole('button', { name: '투명 스티커 즐겨찾기', exact: true }).click()
  await expect(page.getByRole('button', { name: '투명 스티커 즐겨찾기', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '투명 스티커 정보 편집' }).click()
  await page.getByRole('textbox', { name: '스티커 이름', exact: true }).fill('양')
  await page.getByRole('textbox', { name: '스티커 분류', exact: true }).fill('동물')
  await page.getByRole('button', { name: '정보 저장', exact: true }).click()
  await expect(page.getByRole('img', { name: '양', exact: true })).toBeVisible()
  await page.getByRole('dialog', { name: '스티커 관리', exact: true }).getByLabel('분류 필터', { exact: true }).selectOption('동물')
  await expect(page.getByRole('article')).toHaveCount(1)
  await rm(stickerPath)
  await restartWithLibrary()
  await openManager()
  await expect(page.getByRole('button', { name: '양 즐겨찾기', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => page.getByRole('img', { name: '양', exact: true }).evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(resolve(directory, 'profile'))
  await closeManager()
  await select(source); await page.getByRole('button', { name: '사진 열기', exact: true }).click()
  await page.getByRole('button', { name: '양 배치', exact: true }).click()
  await expect(page.getByRole('spinbutton', { name: '스티커 너비' })).toBeVisible()
  await openManager()
  await expect(page.getByRole('button', { name: '양 삭제', exact: true })).toBeDisabled()
  await closeManager()
  const assets = await page.evaluate(() => window.photokkumi.listStickers())
  expect(assets.ok).toBe(true)
  if (!assets.ok) throw new Error('library failed')
  const active = assets.value.find(item => item.name === '양')!
  expect((await page.evaluate(id => window.photokkumi.deleteSticker(id), active.id)).ok).toBe(false)
  await save()
  await openManager()
  await page.getByRole('button', { name: '다른 스티커 삭제', exact: true }).click()
  await page.getByRole('button', { name: '삭제 확인', exact: true }).click()
  await expect(page.getByRole('article')).toHaveCount(1)
  expect(await readFile(second)).toBeTruthy()
})
test('라이브러리 백업·복원 병합·취소와 손상 ZIP 실패 시 기존 항목 유지', async () => {
  await openManager()
  await select(stickerPath); await page.getByRole('button', { name: 'PNG 등록', exact: true }).click()
  await expect(page.getByRole('article')).toHaveCount(1)
  await select(directory); await page.getByRole('button', { name: '백업', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('백업 완료')
  const backup = join(directory, 'PhotoKkumi-library_kkumi.zip')
  expect((await readFile(backup)).length).toBeGreaterThan(0)
  await page.getByRole('button', { name: '투명 스티커 삭제', exact: true }).click()
  await page.getByRole('button', { name: '삭제 확인', exact: true }).click()
  await expect(page.getByRole('article')).toHaveCount(0)
  await select(backup); await page.getByRole('button', { name: '복원', exact: true }).click()
  await expect(page.getByRole('article')).toHaveCount(1)
  await select(backup); await page.getByRole('button', { name: '복원', exact: true }).click()
  await expect(page.getByRole('button', { name: '복원', exact: true })).toBeEnabled()
  await expect(page.getByRole('article')).toHaveCount(1)
  const bad = join(directory, 'broken.zip'); await writeFile(bad, 'not a zip')
  await select(bad); await page.getByRole('button', { name: '복원', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('article')).toHaveCount(1)
  await select(null); await page.getByRole('button', { name: '복원', exact: true }).click()
  await expect(page.getByRole('button', { name: '복원', exact: true })).toBeEnabled()
  await expect(page.getByRole('article')).toHaveCount(1)
  const invalid = await page.evaluate(() => window.photokkumi.useSticker('../other.png'))
  expect(invalid.ok).toBe(false)
})

test('선택 스티커 키보드 이동·삭제와 입력 보호, 회전 커서', async () => {
  await load()
  const count = page.getByTestId('instance-count')
  const frame = page.getByTestId('canvas-frame'), box = (await frame.boundingBox())!
  const scale = Number(await frame.getAttribute('data-scale'))
  const clickSticker = async () => {
    await frame.scrollIntoViewIfNeeded()
    const currentBox = (await frame.boundingBox())!
    const currentScale = Number(await frame.getAttribute('data-scale'))
    await page.mouse.click(currentBox.x + 580 * currentScale, currentBox.y + 390 * currentScale)
    await expect(page.getByRole('spinbutton', { name: '중심 X', exact: true })).toBeVisible()
  }
  // Clicking the canvas must transfer focus away from numeric inputs.
  await field('중심 X', 600)
  await clickSticker()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('spinbutton', { name: '중심 X', exact: true })).toHaveValue('601')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Shift+ArrowLeft')
  await page.keyboard.press('Shift+ArrowUp')
  expect(await value('중심 X')).toBe(591)
  expect(await value('중심 Y')).toBe(391)
  await page.getByRole('button', { name: '실행 취소', exact: true }).click()
  expect(await value('중심 Y')).toBe(401)
  await page.getByRole('button', { name: '다시 실행', exact: true }).click()
  expect(await value('중심 Y')).toBe(391)
  const xInput = page.getByRole('spinbutton', { name: '중심 X', exact: true })
  await xInput.focus()
  await page.keyboard.press('ArrowRight')
  expect(await value('중심 Y')).toBe(391)
  expect(await value('중심 X')).toBe(591)
  await xInput.selectText()
  await page.keyboard.press('Backspace')
  await expect(count).toHaveText('1')
  await field('중심 X', 591)
  await xInput.selectText()
  await page.keyboard.press('Delete')
  await expect(count).toHaveText('1')
  await field('중심 X', 591)
  await clickSticker()
  await page.mouse.move(box.x + 591 * scale, box.y + (391 - 20) * scale - 50)
  const stage = page.locator('.konvajs-content')
  await expect(stage).toHaveCSS('cursor', /url\(/)
  await page.mouse.move(box.x + 20, box.y + 20)
  await expect(stage).toHaveCSS('cursor', 'auto')
  await save()
  expect(pixel(await output(), 560, 380)).toEqual([255, 0, 0, 255])
  await clickSticker()
  await page.keyboard.press('Delete')
  await expect(count).toHaveText('0')
  await page.getByRole('button', { name: '실행 취소', exact: true }).click()
  await expect(count).toHaveText('1')
  await clickSticker()
  await page.keyboard.press('Backspace')
  await expect(count).toHaveText('0')
  await page.keyboard.press('ArrowRight')
  await expect(count).toHaveText('0')
  await page.getByRole('button', { name: '실행 취소', exact: true }).click()
  await page.getByRole('button', { name: '선택 복제', exact: true }).click()
  await expect(count).toHaveText('2')
  await requestClose()
  const close = page.getByRole('dialog', { name: '저장하지 않은 편집' })
  await expect(close).toBeVisible()
  await page.keyboard.press('Delete')
  await page.keyboard.press('ArrowRight')
  await expect(count).toHaveText('2')
  await close.getByRole('button', { name: '취소', exact: true }).click()
  await expect(close).not.toBeVisible()
  await clickSticker()
  await page.keyboard.down('Delete')
  await expect(count).toHaveText('1')
  await page.keyboard.down('Delete')
  await page.keyboard.up('Delete')
  await expect(count).toHaveText('1')
})

test('동일 스티커 여러 개와 다른 스티커는 독립 편집·겹침·복제·삭제·undo·전체 저장된다', async () => {
  await load()
  const count = page.getByTestId('instance-count')
  await page.evaluate(() => {
    const original = window.createImageBitmap.bind(window)
    const state = window as unknown as { stickerDecodes: number }; state.stickerDecodes = 0
    window.createImageBitmap = ((source: ImageBitmapSource, options?: ImageBitmapOptions) => {
      state.stickerDecodes++; return original(source, options)
    }) as typeof createImageBitmap
  })
  const previewPixel = (x: number, y: number) => page.getByTestId('photo-content').evaluate((element, point) => {
    const canvas = element as HTMLCanvasElement
    return [...canvas.getContext('2d')!.getImageData(Math.floor(point[0] * canvas.width / 1200), Math.floor(point[1] * canvas.height / 800), 1, 1).data]
  }, [x, y])
  await field('중심 X', 200); await field('중심 Y', 200); await field('스티커 너비', 160); await field('회전', 90)
  await page.getByRole('button', { name: '투명 스티커 배치', exact: true }).click()
  await expect(count).toHaveText('2')
  await expect(page.getByRole('spinbutton', { name: '중심 X', exact: true })).toHaveValue('620')
  await field('중심 X', 500); await field('중심 Y', 200); await field('스티커 너비', 160)
  await page.getByRole('button', { name: '배치 1: 투명 스티커', exact: true }).click()
  await expect(page.getByRole('spinbutton', { name: '중심 X', exact: true })).toHaveValue('200')
  await expect(page.getByRole('spinbutton', { name: '회전', exact: true })).toHaveValue('90')
  const other = join(directory, '노란 스티커.png')
  await writeFile(other, makePng(80, 80, () => [240, 180, 0, 255]))
  await register(other)
  await page.getByRole('button', { name: '노란 스티커 배치', exact: true }).click()
  await field('중심 X', 500); await field('중심 Y', 200); await field('회전', 45)
  await expect(count).toHaveText('3')
  // A non-selected asset must still be protected while any instance references it.
  await openManager()
  await expect(page.getByRole('button', { name: '투명 스티커 삭제', exact: true })).toBeDisabled()
  await closeManager()
  const list = await page.evaluate(() => window.photokkumi.listStickers())
  if (!list.ok) throw new Error('library failed')
  const originalAsset = list.value.find(item => item.name === '투명 스티커')!
  expect((await page.evaluate(id => window.photokkumi.deleteSticker(id), originalAsset.id)).ok).toBe(false)
  await save()
  let image = await output()
  expect(pixel(image, 220, 170)).toEqual([255, 0, 0, 255])
  expect(pixel(image, 220, 230)).toEqual([0, 255, 0, 255])
  expect(pixel(image, 490, 190)).toEqual([240, 180, 0, 255])
  await expect.poll(() => previewPixel(490, 190)).toEqual([240, 180, 0, 255])
  await page.getByRole('button', { name: '뒤로', exact: true }).click()
  await save()
  image = await output('한글 사진_kkumi_1.png')
  expect(pixel(image, 490, 190)).toEqual([255, 0, 0, 255])
  await expect.poll(() => previewPixel(490, 190)).toEqual([255, 0, 0, 255])
  await page.getByRole('button', { name: '실행 취소', exact: true }).click()
  await page.getByRole('button', { name: '선택 삭제', exact: true }).click()
  await expect(count).toHaveText('2')
  await page.getByRole('button', { name: '실행 취소', exact: true }).click()
  await expect(count).toHaveText('3')
  await page.getByRole('button', { name: '다시 실행', exact: true }).click()
  await expect(count).toHaveText('2')
  await page.getByRole('button', { name: '실행 취소', exact: true }).click()
  await page.getByRole('button', { name: '선택 복제', exact: true }).click()
  await expect(count).toHaveText('4')
  await field('중심 X', 800); await field('중심 Y', 400)
  const frame = page.getByTestId('canvas-frame'), box = (await frame.boundingBox())!
  const scale = Number(await frame.getAttribute('data-scale'))
  await page.mouse.click(box.x + 220 * scale, box.y + 170 * scale)
  await expect(page.getByRole('spinbutton', { name: '중심 X', exact: true })).toHaveValue('200')
  await expect(page.getByRole('spinbutton', { name: '회전', exact: true })).toHaveValue('90')
  await failNextOutput()
  await page.getByRole('button', { name: 'PNG로 저장' }).click()
  await expect(page.getByRole('alert')).toContainText('저장하지 못했습니다')
  await expect(count).toHaveText('4')
  await requestClose()
  const close = page.getByRole('dialog', { name: '저장하지 않은 편집' })
  await close.getByRole('button', { name: '취소', exact: true }).click()
  await expect(count).toHaveText('4')
  await save()
  image = await output('한글 사진_kkumi_2.png')
  expect(pixel(image, 800, 400)).toEqual([240, 180, 0, 255])
  expect(pixel(image, 490, 190)).toEqual([240, 180, 0, 255])
  expect(pixel(image, 220, 170)).toEqual([255, 0, 0, 255])
  expect(await page.evaluate(() => (window as unknown as { stickerDecodes: number }).stickerDecodes)).toBe(1)
  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('button', { name: '배치·이력 비우기', exact: true }).click()
  await expect(count).toHaveText('4')
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: '배치·이력 비우기', exact: true }).click()
  await expect(count).toHaveText('0')
  await expect(page.getByRole('button', { name: '실행 취소', exact: true })).toBeDisabled()
  await save()
  await openManager()
  await expect(page.getByRole('button', { name: '투명 스티커 삭제', exact: true })).toBeEnabled()
  await closeManager()
  const released = await page.evaluate(id => window.photokkumi.deleteSticker(id), originalAsset.id)
  expect(released.ok).toBe(true)

})

test('여러 사진의 배치·이력·완료 상태와 저장하고 다음은 독립적이다', async () => {
  await page.evaluate(() => {
    const original = window.createImageBitmap.bind(window)
    const state = window as unknown as { livePhotos: number; photoDecodes: number }
    state.livePhotos = 0; state.photoDecodes = 0
    window.createImageBitmap = (async (source: ImageBitmapSource, options?: ImageBitmapOptions) => {
      const bitmap = await original(source, options)
      if (bitmap.width > 100) {
        state.livePhotos++; state.photoDecodes++
        const close = bitmap.close.bind(bitmap)
        let closed = false
        bitmap.close = () => { if (!closed) { state.livePhotos--; closed = true }; close() }
      }
      return bitmap
    }) as typeof createImageBitmap
  })
  const second = join(directory, '두 번째.png')
  await writeFile(second, makePng(600, 900, () => [80, 100, 120, 255]))
  const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
  const originalHashes = await Promise.all([source, second].map(async path => hash(await readFile(path))))
  await select([source, second]); await page.getByRole('button', { name: '사진 열기', exact: true }).click()
  const firstRow = page.getByRole('button', { name: '사진 1: 한글 사진.png', exact: true })
  const secondRow = page.getByRole('button', { name: '사진 2: 두 번째.png', exact: true })
  await expect(firstRow).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => (window as unknown as { photoDecodes: number }).photoDecodes)).toBe(1)
  await register(stickerPath); await page.getByRole('button', { name: '투명 스티커 배치', exact: true }).click()
  await field('중심 X', 200); await field('중심 Y', 200)
  await select(null); await page.getByRole('button', { name: '저장하고 다음', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('취소')
  await expect(firstRow).toHaveAttribute('aria-pressed', 'true')
  await select(join(directory, 'missing'))
  await page.getByRole('button', { name: '저장하고 다음', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('저장하지 못했습니다')
  await expect(firstRow).toHaveAttribute('aria-pressed', 'true')
  expect(await value('중심 X')).toBe(200)
  await select(directory); await page.getByRole('button', { name: '저장하고 다음', exact: true }).click()
  await expect(secondRow).toHaveAttribute('aria-pressed', 'true')
  await expect(firstRow).toContainText('저장 완료')
  await expect(page.getByTestId('instance-count')).toHaveText('0')
  await expect(page.getByRole('button', { name: '실행 취소', exact: true })).toBeDisabled()
  await openManager()
  await expect(page.getByRole('button', { name: '투명 스티커 삭제', exact: true })).toBeDisabled()
  await closeManager()
  await page.getByRole('button', { name: '투명 스티커 배치', exact: true }).click()
  await field('중심 X', 300); await field('중심 Y', 500)
  await page.getByRole('button', { name: '선택 복제', exact: true }).click()
  await page.getByRole('button', { name: '실행 취소', exact: true }).click()
  await expect(page.getByTestId('instance-count')).toHaveText('1')
  await select(directory); await page.getByRole('button', { name: '저장하고 다음', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('작업이 완료')
  await expect(secondRow).toContainText('저장 완료')
  await page.getByRole('button', { name: '저장하고 다음', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('작업이 완료')
  expect((await readdir(directory)).filter(name => name.includes('_kkumi'))).toHaveLength(2)
  await firstRow.click()
  await expect(firstRow).toHaveAttribute('aria-pressed', 'true')
  expect(await value('중심 X')).toBe(200)
  await expect(page.getByTestId('instance-count')).toHaveText('1')
  await page.getByRole('button', { name: '실행 취소', exact: true }).click()
  expect(await value('중심 Y')).toBe(400)
  await page.getByRole('button', { name: '다시 실행', exact: true }).click()
  expect(await value('중심 Y')).toBe(200)
  await field('중심 X', 220)
  await expect(firstRow).toContainText('저장 후 수정')
  await secondRow.click()
  const dialog = page.getByRole('dialog', { name: '사진을 바꾸기 전 저장' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '취소', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(await value('중심 X')).toBe(220)
  await secondRow.click(); await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '버리기', exact: true }).click()
  await expect(secondRow).toHaveAttribute('aria-pressed', 'true')
  expect(await value('중심 X')).toBe(300)
  expect(await value('중심 Y')).toBe(500)
  await firstRow.click()
  await expect(firstRow).toHaveAttribute('aria-pressed', 'true')
  expect(await value('중심 X')).toBe(200)
  await expect(firstRow).toContainText('저장 완료')
  const firstImage = await output(), secondImage = await output('두 번째_kkumi.png')
  expect(pixel(firstImage, 180, 190)).toEqual([255, 0, 0, 255])
  expect(secondImage.width).toBe(600); expect(secondImage.height).toBe(900)
  expect(pixel(secondImage, 280, 490)).toEqual([255, 0, 0, 255])
  expect(await Promise.all([source, second].map(async path => hash(await readFile(path))))).toEqual(originalHashes)
  await expect.poll(() => page.evaluate(() => (window as unknown as { livePhotos: number }).livePhotos)).toBe(1)
})

test('사진 전환의 저장 실패·취소 및 대상 읽기 실패는 현재 편집을 보존한다', async () => {
  await load(); await field('중심 X', 200)
  const second = join(directory, '다음.png')
  const secondBytes = makePng(400, 300, () => [70, 80, 90, 255])
  await writeFile(second, secondBytes)
  await select([source, second]); await page.getByRole('button', { name: '사진 열기', exact: true }).click()
  await expect(page.getByRole('button', { name: /^사진 \d+:/ })).toHaveCount(2)
  expect(await value('중심 X')).toBe(200)
  const next = page.getByRole('button', { name: '다음 사진', exact: true })
  const dialog = page.getByRole('dialog', { name: '사진을 바꾸기 전 저장' })
  const firstRow = page.getByRole('button', { name: '사진 1: 한글 사진.png', exact: true })
  await next.click(); await expect(dialog).toBeVisible()
  await select(null); await dialog.getByRole('button', { name: '저장', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(firstRow).toHaveAttribute('aria-pressed', 'true')
  expect(await value('중심 X')).toBe(200)
  await next.click(); await expect(dialog).toBeVisible()
  await select(join(directory, 'missing')); await dialog.getByRole('button', { name: '저장', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('저장하지 못했습니다')
  await dialog.getByRole('button', { name: '취소', exact: true }).click()
  await rm(second)
  await next.click(); await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '버리기', exact: true }).click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  expect(await value('중심 X')).toBe(200)
  await expect(page.getByTestId('instance-count')).toHaveText('1')
  await dialog.getByRole('button', { name: '취소', exact: true }).click()
  await writeFile(second, secondBytes)
  await next.click(); await expect(dialog).toBeVisible()
  await select(directory); await dialog.getByRole('button', { name: '저장', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(firstRow).toContainText('저장 완료')
  await expect(page.getByTestId('instance-count')).toHaveText('0')
  await firstRow.click()
  await expect(firstRow).toHaveAttribute('aria-pressed', 'true')
  expect(await value('중심 X')).toBe(200)
  expect((await page.evaluate(() => window.photokkumi.readPhoto('../../secret'))).ok).toBe(false)
})

test('출력 너비·확대 방지·회전 좌표와 PNG 크기 및 입력 경계를 검증한다', async () => {
  await load()
  await field('중심 X', 400); await field('중심 Y', 300); await field('스티커 너비', 160); await field('회전', 90)
  await settings(); await expect(page.getByRole('spinbutton', { name: 'JPG 품질', exact: true })).toBeDisabled()
  await settings(); await page.getByRole('checkbox', { name: '블로그 크기로 리사이즈', exact: true }).check()
  await settings(); await field('가로 사진 길이', 600)
  await expect(page.getByTestId('output-size')).toHaveText('600 × 400 px')
  await save()
  const reduced = await output()
  expect([reduced.width, reduced.height]).toEqual([600, 400])
  expect(pixel(reduced, 210, 135)).toEqual([255, 0, 0, 255])
  expect(pixel(reduced, 210, 165)).toEqual([0, 255, 0, 255])
  await select(source)
  const infos = await page.evaluate(() => window.photokkumi.choosePhotos())
  if (!infos.ok || !infos.value) throw new Error('photo list failed')
  const mismatch = await page.evaluate(({ id, bytes }) => window.photokkumi.saveImage({
    photoId: id, png: new Uint8Array(bytes), output: { format: 'png', resizeEnabled: false, resizeBasis: 'width', landscapeSize: 1600, portraitSize: 900, preventUpscale: true, quality: 100 }
  }), { id: infos.value[0].id, bytes: [...await readFile(join(directory, '한글 사진_kkumi.png'))] })
  expect(mismatch.ok).toBe(false)
  if (!mismatch.ok) expect(mismatch.error).toContain('출력 크기')
  expect((await page.evaluate(() => window.photokkumi.updateOutputSettings({ format: 'png', resizeEnabled: true, resizeBasis: 'width', landscapeSize: 0, portraitSize: 900, preventUpscale: true, quality: 100 }))).ok).toBe(false)
  await settings(); await field('가로 사진 길이', 2400)
  await expect(page.getByTestId('output-size')).toHaveText('1200 × 800 px')
  await save()
  expect((await output('한글 사진_kkumi_1.png')).width).toBe(1200)
  await settings(); await page.getByRole('checkbox', { name: '확대 방지', exact: true }).uncheck()
  await expect(page.getByTestId('output-size')).toHaveText('2400 × 1600 px')
  await save()
  const enlarged = await output('한글 사진_kkumi_2.png')
  expect([enlarged.width, enlarged.height]).toEqual([2400, 1600])
  expect(pixel(enlarged, 840, 540)).toEqual([255, 0, 0, 255])
  for (const invalid of ['0', '-1', '1.5', '8193', '']) {
    await settings(); await page.getByRole('spinbutton', { name: '가로 사진 길이', exact: true }).fill(invalid)
    await expect(page.getByRole('button', { name: 'PNG로 저장' })).toBeDisabled()
    await expect(page.getByRole('alert')).toBeVisible()
  }
  await settings(); await field('가로 사진 길이', 8000)
  await expect(page.getByRole('alert')).toContainText('1,600만')
  await settings(); await page.getByRole('checkbox', { name: '블로그 크기로 리사이즈', exact: true }).uncheck()
  await expect(page.getByRole('button', { name: 'PNG로 저장' })).toBeEnabled()
})

test('투명 PNG와 반투명 스티커는 PNG 알파와 JPG 흰 배경·품질 100·충돌을 보존한다', async () => {
  await writeFile(source, makePng(400, 300, () => [0, 0, 0, 0]))
  await writeFile(stickerPath, makePng(80, 40, () => [255, 0, 0, 128]))
  const original = await readFile(source)
  await load()
  await field('중심 X', 200); await field('중심 Y', 150)
  await save()
  expect(pixel(await output(), 200, 150)).toEqual([255, 0, 0, 128])
  expect(pixel(await output(), 10, 10)[3]).toBe(0)
  await select(source)
  const infos = await page.evaluate(() => window.photokkumi.choosePhotos())
  if (!infos.ok || !infos.value) throw new Error('photo list failed')
  const transparentJpg = await page.evaluate(({ id, bytes }) => window.photokkumi.saveImage({
    photoId: id, png: new Uint8Array(bytes), output: { format: 'jpg', resizeEnabled: false, resizeBasis: 'width', landscapeSize: 1600, portraitSize: 900, preventUpscale: true, quality: 100 }
  }), { id: infos.value[0].id, bytes: [...original] })
  expect(transparentJpg.ok).toBe(false)
  if (!transparentJpg.ok) expect(transparentJpg.error).toContain('흰색 배경')
  await settings(); await page.getByRole('combobox', { name: '출력 형식', exact: true }).selectOption('jpg')
  await settings(); await expect(page.getByRole('spinbutton', { name: 'JPG 품질', exact: true })).toBeDisabled()
  await settings(); await expect(page.getByRole('spinbutton', { name: 'JPG 품질', exact: true })).toHaveValue('100')
  const row = page.getByRole('button', { name: '사진 1: 한글 사진.png', exact: true })
  await expect(row).toContainText('출력 설정 변경')
  const folder = await page.getByTestId('output-folder').textContent()
  await settings(); await select(null); await page.getByRole('button', { name: '출력 폴더 선택' }).click()
  await expect(page.getByTestId('output-folder')).toHaveText(folder!)
  await failNextOutput(); await page.getByRole('button', { name: 'JPG로 저장' }).click()
  await expect(page.getByRole('alert')).toContainText('저장하지 못했습니다')
  await select(directory); await page.getByRole('button', { name: '저장하고 다음' }).click()
  await expect(page.getByRole('status')).toContainText('작업이 완료')
  const bytes = await readFile(join(directory, '한글 사진_kkumi.jpg'))
  const jpg = jpeg.decode(bytes)
  expect([jpg.width, jpg.height]).toEqual([400, 300])
  expect(pixel(jpg as unknown as PNG, 10, 10).slice(0, 3).every(channel => channel >= 250)).toBe(true)
  const center = pixel(jpg as unknown as PNG, 200, 150)
  expect(center[0]).toBeGreaterThan(245); expect(center[1]).toBeGreaterThan(115); expect(center[1]).toBeLessThan(140)
  expect(bytes.includes(Buffer.from('Exif'))).toBe(false)
  expect(bytes.includes(Buffer.from('GPS'))).toBe(false)
  await select(directory); await page.getByRole('button', { name: 'JPG로 저장' }).click()
  await expect(page.getByRole('status')).toContainText('저장 완료')
  expect(await readFile(join(directory, '한글 사진_kkumi.jpg'))).toEqual(bytes)
  expect((await readFile(join(directory, '한글 사진_kkumi_1.jpg'))).length).toBeGreaterThan(0)
  expect(await readFile(source)).toEqual(original)
  expect((await page.evaluate(() => window.photokkumi.updateOutputSettings({ format: 'jpg', resizeEnabled: false, resizeBasis: 'width', landscapeSize: 1600, portraitSize: 900, preventUpscale: true, quality: 90 }))).ok).toBe(false)
  await settings(); await page.getByRole('checkbox', { name: '블로그 크기로 리사이즈', exact: true }).check()
  await settings(); await field('가로 사진 길이', 200)
  await expect.poll(async () => {
    const settings = await page.evaluate(() => window.photokkumi.getOutputSettings())
    return settings.ok ? settings.value.landscapeSize : null
  }).toBe(200)
  await restartWithLibrary()
  await settings(); await expect(page.getByRole('combobox', { name: '출력 형식', exact: true })).toHaveValue('jpg')
  await settings(); await expect(page.getByRole('spinbutton', { name: 'JPG 품질', exact: true })).toHaveValue('100')
  await settings(); await expect(page.getByRole('spinbutton', { name: '가로 사진 길이', exact: true })).toHaveValue('200')
})

test('출력 설정 쓰기 실패는 기존 설정과 편집을 보존하고 버리기로 종료할 수 있다', async () => {
  await load(); await field('회전', 25)
  await settings(); await page.getByRole('combobox', { name: '출력 형식', exact: true }).selectOption('jpg')
  await expect.poll(async () => {
    const result = await page.evaluate(() => window.photokkumi.getOutputSettings())
    return result.ok ? result.value.format : ''
  }).toBe('jpg')
  const path = join(directory, 'profile', 'settings.json')
  const before = await readFile(path)
  await app.evaluate(() => {
    const fs = process.getBuiltinModule('node:fs/promises') as typeof import('node:fs/promises')
    const rename = fs.rename.bind(fs)
    fs.rename = async (...args: Parameters<typeof fs.rename>) => {
      if (String(args[1]).endsWith('settings.json')) throw new Error('settings denied')
      return rename(...args)
    }
  })
  await settings(); await page.getByRole('checkbox', { name: '확대 방지', exact: true }).uncheck()
  await expect(page.getByRole('alert')).toContainText('출력 설정')
  expect(await readFile(path)).toEqual(before)
  await select(directory); await page.getByRole('button', { name: '저장하고 다음' }).click()
  await expect(page.getByRole('button', { name: 'JPG로 저장' })).toBeEnabled()
  await expect(page.getByRole('alert')).toContainText('출력 설정')
  expect(await value('회전')).toBe(25)
  expect((await readdir(directory)).some(name => name.includes('_kkumi'))).toBe(false)
  await requestClose()
  const dialog = page.getByRole('dialog', { name: '저장하지 않은 편집' })
  await expect(dialog).toBeVisible()
  const closed = page.waitForEvent('close')
  await dialog.getByRole('button', { name: '버리기', exact: true }).click()
  await closed
  expect(await readFile(path)).toEqual(before)
  expect((await readdir(join(directory, 'profile'))).some(name => name.endsWith('.tmp'))).toBe(false)
})

test('입력 폴더·하단 썸네일·출력 폴더 재사용과 방향별 블로그 크기로 저장한다', async () => {
  const fs = await import('node:fs/promises')
  const input = join(directory, '입력'), target = join(directory, '결과')
  await fs.mkdir(input); await fs.mkdir(target)
  await writeFile(join(input, '가로.png'), makePng(2200, 1400, () => [20, 40, 200, 255]))
  await writeFile(join(input, '세로.png'), makePng(1400, 2200, () => [50, 80, 120, 255]))
  await writeFile(join(input, '손상.png'), 'invalid')
  await writeFile(join(input, 'notes.txt'), 'ignored')
  await fs.mkdir(join(input, 'nested'))
  await writeFile(join(input, 'nested', '숨김.png'), makePng(20, 20, () => [0, 0, 0, 255]))
  await select(input); await page.getByRole('button', { name: '폴더 열기' }).click()
  await expect(page.getByRole('status')).toContainText('1개 제외')
  const rows = page.getByRole('button', { name: /^사진 \d+:/ })
  await expect(rows).toHaveCount(2)
  const strip = (await page.getByRole('region', { name: '사진 목록' }).boundingBox())!
  const canvas = (await page.getByTestId('canvas-area').boundingBox())!
  expect(strip.y).toBeGreaterThanOrEqual(canvas.y + canvas.height)
  const first = page.getByRole('button', { name: '사진 1: 가로.png' })
  const second = page.getByRole('button', { name: '사진 2: 세로.png' })
  await expect(first).toHaveAttribute('aria-pressed', 'true')
  await register(stickerPath)
  await page.getByRole('button', { name: '투명 스티커 배치', exact: true }).click()
  await settings(); await select(target); await page.getByRole('button', { name: '출력 폴더 선택' }).click()
  await expect(page.getByTestId('output-folder')).toContainText('결과')
  await settings(); await select(null); await page.getByRole('button', { name: '출력 폴더 선택' }).click()
  await expect(page.getByTestId('output-folder')).toContainText('결과')
  await settings(); await page.getByRole('checkbox', { name: '블로그 크기로 리사이즈' }).check()
  await settings(); await expect(page.getByRole('spinbutton', { name: '가로 사진 길이' })).toHaveValue('1600')
  await settings(); await expect(page.getByRole('spinbutton', { name: '세로 사진 길이' })).toHaveValue('900')
  await expect(page.getByTestId('output-size')).toHaveText('1600 × 1018 px')
  await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => { throw new Error('추가 폴더 선택 금지') } })
  await page.getByRole('button', { name: '저장하고 다음' }).click()
  await expect(second).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('instance-count')).toHaveText('0')
  await expect(page.getByTestId('output-size')).toHaveText('900 × 1414 px')
  await page.getByRole('button', { name: '투명 스티커 배치', exact: true }).click()
  await page.getByRole('button', { name: '저장하고 다음' }).click()
  await expect(page.getByRole('status')).toContainText('작업이 완료')
  const landscape = PNG.sync.read(await readFile(join(target, '가로_kkumi.png')))
  const portrait = PNG.sync.read(await readFile(join(target, '세로_kkumi.png')))
  expect([landscape.width, landscape.height]).toEqual([1600, 1018])
  expect([portrait.width, portrait.height]).toEqual([900, 1414])
  await settings(); await page.getByRole('combobox', { name: '리사이즈 기준' }).selectOption('longEdge')
  await expect(page.getByTestId('output-size')).toHaveText('573 × 900 px')
  await page.getByRole('button', { name: 'PNG로 저장' }).click()
  await expect(page.getByRole('status')).toContainText('저장 완료')
  const long = PNG.sync.read(await readFile(join(target, '세로_kkumi_1.png')))
  expect([long.width, long.height]).toEqual([573, 900])
  const newTarget = join(directory, '결과2'); await fs.mkdir(newTarget)
  await settings(); await select(newTarget); await page.getByRole('button', { name: '출력 폴더 선택' }).click()
  await expect(second).toContainText('출력 폴더 변경')
  await page.getByRole('button', { name: '저장하고 다음' }).click()
  await expect(page.getByRole('status')).toContainText('작업이 완료')
  expect((await fs.readdir(newTarget))).toEqual(['세로_kkumi.png'])
})

test('확대·화면 이동은 저장 좌표를 바꾸지 않고 단축키와 관리 화면을 분리한다', async () => {
  await load()
  await expect(page.getByRole('button', { name: 'PNG 등록', exact: true })).toHaveCount(0)
  await field('중심 X', 400); await field('중심 Y', 300); await field('스티커 너비', 160); await field('회전', 90)
  await save()
  const before = await readFile(join(directory, '한글 사진_kkumi.png'))
  await page.getByRole('button', { name: '100%', exact: true }).click()
  const frame = page.getByTestId('canvas-frame')
  await expect(frame).toHaveAttribute('data-scale', '1')
  const wheelBox = (await frame.boundingBox())!
  await page.mouse.move(wheelBox.x + wheelBox.width / 2, wheelBox.y + wheelBox.height / 2)
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -100); await page.keyboard.up('Control')
  await expect.poll(async () => Number(await frame.getAttribute('data-scale'))).toBeGreaterThan(1)
  await page.getByRole('button', { name: '100%', exact: true }).click()
  await expect(frame).toHaveAttribute('data-scale', '1')
  await page.getByRole('button', { name: '화면 이동', exact: true }).click()
  const box = (await frame.boundingBox())!
  const oldPan = Number(await frame.getAttribute('data-pan-x'))
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 - 80, box.y + box.height / 2 - 40, { steps: 10 })
  await page.mouse.up()
  await page.screenshot({ path: test.info().outputPath('zoom.png') })
  await expect.poll(async () => Number(await frame.getAttribute('data-pan-x'))).toBeLessThan(oldPan)
  expect(await value('중심 X')).toBe(400)
  expect(await value('중심 Y')).toBe(300)
  await save()
  expect(await readFile(join(directory, '한글 사진_kkumi_1.png'))).toEqual(before)
  await page.getByRole('button', { name: '화면 맞춤', exact: true }).click()
  await expect(frame).toHaveAttribute('data-pan-x', '0')
  expect(Number(await frame.getAttribute('data-scale'))).toBeLessThan(1)
  await page.getByTestId('canvas-area').focus()
  await page.keyboard.press('Control+d')
  await expect(page.getByTestId('instance-count')).toHaveText('2')
  await page.keyboard.press('Control+z')
  await expect(page.getByTestId('instance-count')).toHaveText('1')
  await page.keyboard.press('Control+Shift+z')
  await expect(page.getByTestId('instance-count')).toHaveText('2')
  await page.keyboard.press('Control+z'); await page.keyboard.press('Control+y')
  await expect(page.getByTestId('instance-count')).toHaveText('2')
  await page.getByRole('spinbutton', { name: '중심 X', exact: true }).focus()
  await page.keyboard.press('Control+d')
  await expect(page.getByTestId('instance-count')).toHaveText('2')
  await openManager()
  await expect(page.getByRole('button', { name: 'PNG 등록', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '투명 스티커 배치', exact: true })).toHaveCount(0)
  await page.keyboard.press('Control+d'); await page.keyboard.press('Control+z')
  await expect(page.getByTestId('instance-count')).toHaveText('2')
  await closeManager()
  await expect(page.getByRole('button', { name: '투명 스티커 배치', exact: true })).toBeVisible()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(760, 580))
  await expect.poll(async () => (await page.getByTestId('canvas-area').boundingBox())!.height).toBeGreaterThan(80)
  await page.screenshot({ path: test.info().outputPath('minimum-window.png') })
})

test('최소 창 크기에서도 페이지·우측 패널은 스크롤하지 않고 스티커 목록만 스크롤한다', async () => {
  const paths = []
  for (let index = 0; index < 18; index++) {
    const path = join(directory, `도형${index}.png`)
    await writeFile(path, makePng(30, 30, () => [index * 12, 100, 200 - index * 8, 255]))
    paths.push(path)
  }
  await select(source); await page.getByRole('button', { name: '사진 열기', exact: true }).click()
  await register(paths)
  await page.getByRole('button', { name: '도형0 배치', exact: true }).click()
  await expect(page.getByRole('spinbutton', { name: '스티커 너비' })).toBeVisible()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(760, 580))
  await expect.poll(() => page.evaluate(() => window.innerHeight)).toBe(580)
  const layout = await page.evaluate(() => {
    const overflow = (element: Element | null) => !!element && element.scrollHeight > element.clientHeight + 1
    const toolbar = document.querySelector('.toolbar')!.getBoundingClientRect()
    return {
      page: document.documentElement.scrollHeight > window.innerHeight || document.documentElement.scrollWidth > window.innerWidth,
      aside: overflow(document.querySelector('aside')), grid: overflow(document.querySelector('aside .sticker-grid')),
      toolbarHeight: toolbar.height, canvas: document.querySelector('[data-testid=canvas-area]')!.getBoundingClientRect().height
    }
  })
  expect(layout).toMatchObject({ page: false, aside: false, grid: true })
  expect(layout.toolbarHeight).toBeLessThanOrEqual(52)
  expect(layout.canvas).toBeGreaterThan(250)
  await expect(page.getByRole('spinbutton', { name: '스티커 너비' })).toBeInViewport()
})

async function drop(paths: string[]) {
  // setInputFiles yields file-backed File objects, the same kind the OS file manager provides on drop.
  await page.evaluate(() => { const input = document.createElement('input'); input.type = 'file'; input.multiple = true; input.id = 'drop-source'; input.hidden = true; document.body.append(input) })
  await page.locator('#drop-source').setInputFiles(paths)
  await page.evaluate(() => {
    const input = document.getElementById('drop-source') as HTMLInputElement, transfer = new DataTransfer()
    for (const file of Array.from(input.files ?? [])) transfer.items.add(file)
    const target = document.querySelector('main')!
    target.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: transfer }))
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
    input.remove()
  })
}

test('탐색기에서 끌어 놓은 사진은 목록에 추가되고 썸네일에서 제거할 수 있다', async () => {
  const second = join(directory, '두 번째.png'), memo = join(directory, '메모.txt')
  await writeFile(second, makePng(300, 200, () => [200, 40, 20, 255])); await writeFile(memo, 'memo')
  await expect(page.getByText('사진을 이 창으로 끌어다 놓으세요')).toBeVisible()
  await drop([source])
  await expect(page.getByRole('button', { name: '사진 1: 한글 사진.png', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await drop([source, second, memo])
  await expect(page.getByRole('button', { name: /^사진 \d+:/ })).toHaveCount(2)
  await expect(page.getByRole('status')).toContainText('1장 추가')
  await expect(page.getByRole('status')).toContainText('메모.txt')
  await expect(page.locator('.drop-overlay')).toHaveCount(0)

  await register(stickerPath)
  await page.getByRole('button', { name: '투명 스티커 배치', exact: true }).click()
  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('button', { name: '한글 사진.png 목록에서 제거', exact: true }).click()
  await expect(page.getByRole('button', { name: /^사진 \d+:/ })).toHaveCount(2)
  await expect(page.getByTestId('instance-count')).toHaveText('1')
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: '한글 사진.png 목록에서 제거', exact: true }).click()
  await expect(page.getByRole('button', { name: /^사진 \d+:/ })).toHaveCount(1)
  await expect(page.getByRole('button', { name: '사진 1: 두 번째.png', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('instance-count')).toHaveText('0')
  await page.getByRole('button', { name: '두 번째.png 목록에서 제거', exact: true }).click()
  await expect(page.getByRole('region', { name: '사진 목록' })).toHaveCount(0)
  await expect(page.getByText('사진을 이 창으로 끌어다 놓으세요')).toBeVisible()
  await expect(page.getByRole('button', { name: 'PNG로 저장' })).toBeDisabled()
  await drop([second])
  await expect(page.getByRole('button', { name: '사진 1: 두 번째.png', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect(errors).toEqual([])
})

test('블러·모자이크 영역을 드래그로 그리고 이동·강도 조절·undo 후 저장 결과에서 원본 픽셀을 가린다', async () => {
  // Vertical 2px stripes: any blur turns the inside gray, mosaic turns each block into one flat color.
  await writeFile(source, makePng(1200, 800, x => Math.floor(x / 2) % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255]))
  await load()
  await page.getByRole('button', { name: '선택 삭제', exact: true }).click()
  const frame = page.getByTestId('canvas-frame'), box = (await frame.boundingBox())!
  const scale = Number(await frame.getAttribute('data-scale'))
  const at = (x: number, y: number) => [box.x + x * scale, box.y + y * scale] as const
  const toggle = page.getByRole('button', { name: '블러·모자이크' })
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await toggle.click()
  await expect(page.getByRole('radio', { name: '블러' })).toHaveAttribute('aria-checked', 'true')
  await page.mouse.move(...at(300, 200)); await page.mouse.down()
  await page.mouse.move(...at(500, 400), { steps: 10 }); await page.mouse.up()
  await expect(page.getByTestId('region-count')).toHaveText('1')
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(async () => Math.abs(await value('중심 X') - 400)).toBeLessThan(3 / scale)
  await expect.poll(async () => Math.abs(await value('영역 너비') - 200)).toBeLessThan(3 / scale)
  // Drag the ellipse itself, then nudge with the keyboard like a sticker.
  await page.mouse.move(...at(400, 300)); await page.mouse.down()
  await page.mouse.move(...at(500, 300), { steps: 10 }); await page.mouse.up()
  await expect.poll(async () => Math.abs(await value('중심 X') - 500)).toBeLessThan(3 / scale)
  await field('중심 X', 600); await field('중심 Y', 400); await field('영역 너비', 200); await field('영역 높이', 200)
  await page.getByTestId('canvas-area').click({ position: { x: 5, y: 5 } })
  await page.getByRole('button', { name: '가림 1: 블러', exact: true }).click()
  await page.getByTestId('canvas-area').focus(); await page.keyboard.press('ArrowRight')
  expect(await value('중심 X')).toBe(601)
  await page.keyboard.press('ArrowLeft')

  // A slider drag is one undo step.
  const slider = page.getByRole('slider', { name: '가림 강도 슬라이더' })
  const before = await value('가림 강도')
  const sliderBox = (await slider.boundingBox())!
  await page.mouse.move(sliderBox.x + sliderBox.width * before / 100, sliderBox.y + sliderBox.height / 2); await page.mouse.down()
  await page.mouse.move(sliderBox.x + sliderBox.width * 0.7, sliderBox.y + sliderBox.height / 2, { steps: 8 })
  await page.mouse.move(sliderBox.x + sliderBox.width * 0.9, sliderBox.y + sliderBox.height / 2, { steps: 8 }); await page.mouse.up()
  expect(await value('가림 강도')).toBeGreaterThan(80)
  await page.getByRole('button', { name: '실행 취소', exact: true }).click()
  expect(await value('가림 강도')).toBe(before)
  await page.getByRole('button', { name: '다시 실행', exact: true }).click()
  await field('가림 강도', 60)

  await save()
  const blurred = await output()
  const inside = pixel(blurred, 600, 400), outside = pixel(blurred, 200, 100)
  expect(inside[0]).toBeGreaterThan(90); expect(inside[0]).toBeLessThan(165)
  expect(pixel(blurred, 601, 400)[0]).toBeLessThan(pixel(blurred, 600, 400)[0] + 20)
  expect([outside[0], pixel(blurred, 202, 100)[0]].sort()).toEqual([0, 255])
  expect(pixel(blurred, 600, 296)[0] === 0 || pixel(blurred, 600, 296)[0] === 255).toBe(true)

  await page.getByRole('radio', { name: '모자이크' }).click()
  await field('가림 강도', 100)
  await save()
  const mosaic = await output('한글 사진_kkumi_1.png')
  // 200px circle at strength 100 → 50px blocks aligned to the photo grid (550–600, 600–650).
  expect(pixel(mosaic, 560, 380)).toEqual(pixel(mosaic, 595, 395))
  expect(pixel(mosaic, 560, 380)[0]).toBeGreaterThan(100); expect(pixel(mosaic, 560, 380)[0]).toBeLessThan(155)
  await page.getByRole('button', { name: '선택 삭제', exact: true }).click()
  await expect(page.getByTestId('region-count')).toHaveCount(0)
  await page.getByRole('button', { name: '실행 취소', exact: true }).click()
  await expect(page.getByTestId('region-count')).toHaveText('1')
  expect(errors).toEqual([])
})

test('보정은 사진에만 적용되고 슬라이더 1회 undo·초기화·모든 사진에 적용·저장 결과가 일치한다', async () => {
  await writeFile(source, makePng(1200, 800, () => [100, 100, 100, 255]))
  const second = join(directory, '둘째.png')
  await writeFile(second, makePng(400, 300, () => [100, 100, 100, 255]))
  await select([source, second]); await page.getByRole('button', { name: '사진 열기', exact: true }).click()
  await register(stickerPath)
  await page.getByRole('button', { name: '투명 스티커 배치', exact: true }).click()
  await field('중심 X', 600); await field('중심 Y', 400); await field('스티커 너비', 80)
  await page.getByRole('tab', { name: /보정/ }).click()
  await expect(page.getByRole('button', { name: '초기화', exact: true })).toBeDisabled()
  const slider = page.getByRole('slider', { name: '노출 슬라이더' }), box = (await slider.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height / 2, { steps: 6 })
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2, { steps: 6 }); await page.mouse.up()
  const dragged = await value('노출')
  expect(dragged).toBeGreaterThan(30)
  await page.getByRole('button', { name: '실행 취소', exact: true }).click()
  expect(await value('노출')).toBe(0)
  await page.getByRole('button', { name: '다시 실행', exact: true }).click()
  expect(await value('노출')).toBe(dragged)
  await field('노출', 50); await field('색온도', -40)
  await expect(page.getByRole('tab', { name: /보정/ })).toContainText('보정')
  // Preview uses the same adjustment as export.
  await expect.poll(() => page.evaluate(() => {
    const canvas = document.querySelector('[data-testid=photo-content]') as HTMLCanvasElement
    return [...canvas.getContext('2d')!.getImageData(10, 10, 1, 1).data]
  })).not.toEqual([100, 100, 100, 255])

  await page.getByRole('button', { name: '모든 사진에 적용', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('1장에 적용')
  await expect(page.getByRole('button', { name: '사진 2: 둘째.png', exact: true })).toContainText('수정됨')

  await save()
  const result = await output()
  const photoPixel = pixel(result, 100, 100)
  expect(photoPixel[0]).toBeGreaterThan(115); expect(photoPixel[2]).toBeGreaterThan(photoPixel[0] + 15)
  // Sticker colours (red/green halves) are not adjusted.
  expect(pixel(result, 580, 395)).toEqual([255, 0, 0, 255])
  expect(pixel(result, 620, 395)).toEqual([0, 255, 0, 255])

  await page.getByRole('button', { name: '저장하고 다음' }).click()
  await expect(page.getByRole('button', { name: '사진 2: 둘째.png', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('tab', { name: /보정/ })).toHaveAttribute('aria-selected', 'true')
  expect(await value('노출')).toBe(50); expect(await value('색온도')).toBe(-40)
  await page.getByRole('button', { name: '초기화', exact: true }).click()
  expect(await value('노출')).toBe(0)
  await page.getByRole('button', { name: '실행 취소', exact: true }).click()
  expect(await value('노출')).toBe(50)
  expect(errors).toEqual([])
})

function findFfmpeg() {
  const { spawnSync } = process.getBuiltinModule('node:child_process') as typeof import('node:child_process')
  for (const candidate of [process.env.FFMPEG_PATH, 'ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'].filter(Boolean) as string[]) {
    const result = spawnSync(candidate, ['-hide_banner', '-version'], { encoding: 'utf8' })
    if (result.status === 0 && result.stdout.startsWith('ffmpeg version')) return candidate
  }
  return null
}
async function relaunch(env: Record<string, string>) {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy()))
  await app.close().catch(error => { if (!page.isClosed()) throw error })
  app = await electron.launch({ args: [resolve('out/main/index.js'), `--user-data-dir=${join(directory, 'profile')}`], env: { ...process.env, ELECTRON_RENDERER_URL: '', ...env } })
  page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await expect(page.getByRole('heading', { name: '포토꾸미', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '사진 열기', exact: true })).toBeEnabled()
  await app.context().setOffline(true)
}

test('GIF 만들기: ffmpeg 미설치 안내·위치 지정, 회전 HEVC MOV 드롭, [ ] 구간 선택, 원본 불변 GIF 저장', async () => {
  const ffmpeg = findFfmpeg()
  test.skip(!ffmpeg, 'ffmpeg가 설치되지 않은 환경')
  const { spawnSync } = process.getBuiltinModule('node:child_process') as typeof import('node:child_process')
  const raw = join(directory, 'raw.mov'), clip = join(directory, 'IMG_0001.MOV')
  // 4s 320×240 HEVC, then remuxed with a 90° display matrix like an iPhone portrait clip.
  expect(spawnSync(ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30', '-t', '4', '-c:v', 'libx265', '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p', raw]).status).toBe(0)
  expect(spawnSync(ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-display_rotation', '90', '-i', raw, '-c', 'copy', clip]).status).toBe(0)
  const originalHash = createHash('sha256').update(await readFile(clip)).digest('hex')

  await relaunch({ PHOTOKKUMI_FFMPEG_CANDIDATES: '' })
  await page.getByRole('tab', { name: 'GIF 만들기' }).click()
  await expect(page.getByRole('heading', { name: 'GIF 만들기에는 ffmpeg가 필요합니다' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: '설치 명령' })).toHaveValue(/ffmpeg/i)
  await page.getByRole('button', { name: '다시 찾기' }).click()
  await expect(page.getByRole('status')).toContainText('찾지 못했습니다')
  await select(source); await page.getByRole('button', { name: 'ffmpeg 위치 선택' }).click()
  await expect(page.getByRole('alert')).toContainText('ffmpeg가 아닙니다')
  const { realpathSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
  const absolute = ffmpeg!.includes('/') || ffmpeg!.includes('\\') ? ffmpeg! : spawnSync(process.platform === 'win32' ? 'where' : 'which', [ffmpeg!], { encoding: 'utf8' }).stdout.split(/\r?\n/)[0]
  await select(realpathSync(absolute)); await page.getByRole('button', { name: 'ffmpeg 위치 선택' }).click()
  await expect(page.getByText('동영상을 이 창으로 끌어다 놓으세요')).toBeVisible()

  // The chosen location persists across restarts even with no search candidates.
  await relaunch({ PHOTOKKUMI_FFMPEG_CANDIDATES: '' })
  // Drop the video while in photo mode: the app switches to the GIF maker.
  await drop([clip])
  await expect(page.getByRole('tab', { name: 'GIF 만들기' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('gif-frame')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('4.0초 · 240 × 320')).toBeVisible()
  await expect(page.getByTestId('gif-span')).toHaveText('3.0초')
  await expect(page.getByTestId('gif-size')).toHaveText('240 × 320')

  // Keyboard: move 1s, set start; move to 3.5s, set end.
  await page.getByRole('region', { name: 'GIF 만들기' }).or(page.getByLabel('GIF 만들기', { exact: true })).first().focus()
  await page.keyboard.press('Shift+ArrowRight'); await page.keyboard.press('[')
  await expect(page.getByRole('spinbutton', { name: '시작 시간' })).toHaveValue('1')
  await page.keyboard.press('Shift+ArrowRight'); await page.keyboard.press('Shift+ArrowRight')
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight')
  await page.keyboard.press(']')
  await expect(page.getByRole('spinbutton', { name: '끝 시간' })).toHaveValue('3.5')
  await expect(page.getByTestId('gif-span')).toHaveText('2.5초')
  // Dragging the end handle to the far right selects up to the end of the clip.
  const track = (await page.getByTestId('gif-track').boundingBox())!
  const handle = (await page.getByRole('button', { name: '끝 핸들' }).boundingBox())!
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down()
  await page.mouse.move(track.x + track.width + 20, handle.y + handle.height / 2, { steps: 6 }); await page.mouse.up()
  await expect(page.getByRole('spinbutton', { name: '끝 시간' })).toHaveValue('4')
  await page.getByRole('spinbutton', { name: '끝 시간' }).fill('3')
  await page.getByRole('combobox', { name: 'GIF FPS' }).selectOption('10')

  await select(directory)
  await page.getByRole('button', { name: 'GIF로 저장' }).click()
  await expect(page.getByRole('status')).toContainText('GIF 저장 완료', { timeout: 30_000 })
  const gif = await readFile(join(directory, 'IMG_0001_kkumi.gif'))
  expect(gif.subarray(0, 6).toString('latin1')).toBe('GIF89a')
  expect([gif.readUInt16LE(6), gif.readUInt16LE(8)]).toEqual([240, 320])
  const frames = spawnSync(ffmpeg!, ['-hide_banner', '-i', join(directory, 'IMG_0001_kkumi.gif'), '-map', '0:v', '-f', 'null', '-'], { encoding: 'utf8' }).stderr
  expect(Number(/frame=\s*(\d+)/.exec(frames.split('frame=').length > 1 ? frames.slice(frames.lastIndexOf('frame=')) : '')?.[1])).toBe(20)
  // Saving again never overwrites the first result.
  await page.getByRole('button', { name: 'GIF로 저장' }).click()
  await expect(page.getByRole('status')).toContainText('IMG_0001_kkumi_1.gif', { timeout: 30_000 })
  expect(createHash('sha256').update(await readFile(clip)).digest('hex')).toBe(originalHash)
  expect((await readdir(join(directory, 'profile'))).includes('tools.json')).toBe(true)

  // Photo editing state is independent of the GIF mode.
  await page.getByRole('tab', { name: '사진 편집' }).click()
  await expect(page.getByText('사진을 이 창으로 끌어다 놓으세요')).toBeVisible()
  expect(errors).toEqual([])
})
