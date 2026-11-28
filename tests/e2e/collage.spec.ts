import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import type { ChildProcess } from 'node:child_process'
import { PNG } from 'pngjs'
import jpeg from 'jpeg-js'

// 사진 합치기 E2E. Launch/teardown helpers are copied from editor.spec.ts (forced kill so no Electron outlives the run).
let app: ElectronApplication
let page: Page
let directory: string
const errors: string[] = []
const launched = new Map<ElectronApplication, ChildProcess>()
const running = (child: ChildProcess) => child.exitCode === null && child.signalCode === null
process.once('exit', () => { for (const child of launched.values()) if (running(child)) child.kill('SIGKILL') })
async function launchApp() {
  const target = await electron.launch({ args: [resolve('out/main/index.js'), `--user-data-dir=${join(directory, 'profile')}`], env: { ...process.env, ELECTRON_RENDERER_URL: '', PHOTOKKUMI_DEFAULT_STICKERS: 'none' } })
  launched.set(target, target.process())
  return target
}
const delay = (ms: number) => new Promise<void>(done => setTimeout(done, ms))
async function closeApp(target: ElectronApplication) {
  const child = launched.get(target)
  if (child && running(child)) {
    const exited = new Promise<void>(done => child.once('exit', () => done()))
    await Promise.race([target.close().catch(() => undefined), delay(10_000)])
    if (running(child)) child.kill('SIGKILL')
    await Promise.race([exited, delay(5_000)])
  } else if (!child) await target.close().catch(() => undefined)
  launched.delete(target)
}
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
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
function rgb(image: { width: number; data: Uint8Array | Buffer }, x: number, y: number) { const at = (image.width * y + x) * 4; return [image.data[at], image.data[at + 1], image.data[at + 2]] }
function near(actual: number[], expected: number[], tolerance = 12) { expect(actual.every((value, index) => Math.abs(value - expected[index]) <= tolerance), `${actual} ≈ ${expected}`).toBe(true) }

test.beforeEach(async () => {
  errors.length = 0
  directory = await mkdtemp(join(tmpdir(), 'photokkumi-collage-'))
  app = await launchApp()
  page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await expect(page.getByRole('button', { name: '사진 열기', exact: true })).toBeVisible()
  await app.context().setOffline(true)
})
test.afterEach(async () => {
  if (app) {
    if (page && !page.isClosed()) await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy()))
    await closeApp(app)
  }
  if (directory) await rm(directory, { recursive: true, force: true })
  expect(errors).toEqual([])
})

const RED = [220, 30, 30], MAGENTA = [255, 0, 255], GREEN = [30, 180, 60], BLUE = [30, 60, 220], YELLOW = [240, 210, 20]
test('사진 합치기: 2×2·세로 이어붙이기 저장 픽셀, 편집 반영, 끌기, 이름 번호, 원본 불변, 최소 창', async () => {
  // Synthetic solid photos; the first one has a magenta strip on the left that only shows after panning.
  const files: [string, Buffer][] = [
    ['1 빨강.png', makePng(1200, 800, x => x < 200 ? [...MAGENTA, 255] : [...RED, 255])],
    ['2 초록.png', makePng(800, 1200, () => [...GREEN, 255])],
    ['3 파랑.png', makePng(1000, 1000, () => [...BLUE, 255])],
    ['4 노랑.png', makePng(1200, 900, () => [...YELLOW, 255])]
  ]
  const paths = files.map(([name]) => join(directory, name))
  for (const [index, [, bytes]] of files.entries()) await writeFile(paths[index], bytes)
  const before = await Promise.all(paths.map(async path => hash(await readFile(path))))
  const output = join(directory, '결과')
  await (await import('node:fs/promises')).mkdir(output)

  await select(paths); await page.getByRole('button', { name: '사진 열기', exact: true }).click()
  await expect(page.getByRole('button', { name: /^사진 4:/ })).toBeVisible()
  // Edit photo 2 in the editor: a 90° turn (800×1200 → 1200×800) must reach the collage.
  await page.getByRole('button', { name: /^사진 2:/ }).click()
  await page.getByRole('tab', { name: /자르기/ }).click()
  await page.getByRole('button', { name: '오른쪽으로 90° 회전' }).click()
  await page.getByRole('button', { name: '완료', exact: true }).click()

  await page.getByRole('tab', { name: '사진 합치기' }).click()
  await expect(page.getByRole('tab', { name: '사진 합치기' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('radio', { name: '4장 2×2' })).toHaveAttribute('aria-checked', 'true')
  const saveButton = page.getByRole('button', { name: '합친 사진 저장' })
  await expect(saveButton).toBeEnabled()
  await expect(page.getByRole('button', { name: /^칸 1: 1 빨강/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^칸 4: 4 노랑/ })).toBeVisible()

  await page.getByRole('spinbutton', { name: '간격', exact: true }).fill('20')
  await page.getByRole('radio', { name: '배경색: 검정' }).click()
  await page.getByRole('radio', { name: 'PNG' }).click()
  await expect(page.getByTestId('collage-size')).toHaveText('1080 × 1080 px · PNG')
  // Drag cell 1's photo all the way right: its left (magenta) strip comes into view.
  const first = (await page.getByRole('button', { name: /^칸 1:/ }).boundingBox())!
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2); await page.mouse.down()
  await page.mouse.move(first.x + first.width / 2 + 400, first.y + first.height / 2, { steps: 8 }); await page.mouse.up()

  await select(output)
  await saveButton.click()
  await expect(page.getByRole('status')).toContainText('합친 사진 저장 완료 · 1 빨강_collage.png')
  const grid = PNG.sync.read(await readFile(join(output, '1 빨강_collage.png')))
  expect([grid.width, grid.height]).toEqual([1080, 1080])
  // gap 20 + outer margin 20: cells at x/y 20 and 550, 510 px square.
  near(rgb(grid, 275, 275), RED); near(rgb(grid, 805, 275), GREEN); near(rgb(grid, 275, 805), BLUE); near(rgb(grid, 805, 805), YELLOW)
  near(rgb(grid, 30, 275), MAGENTA) // panned: source x 0–800 → the first 127 px are magenta
  near(rgb(grid, 540, 275), [0, 0, 0], 2); near(rgb(grid, 5, 5), [0, 0, 0], 2); near(rgb(grid, 275, 1075), [0, 0, 0], 2)

  // Second save: a numbered name, the first file untouched.
  await saveButton.click()
  await expect(page.getByRole('status')).toContainText('1 빨강_collage_1.png')

  // Swap cells 1 and 4, then a vertical stack (keeps the four photos) as JPG on white with no outer margin.
  await page.getByRole('button', { name: /^칸 1:/ }).click()
  await page.getByRole('button', { name: '⇄ 다른 칸과 바꾸기' }).click()
  await page.getByRole('button', { name: /^칸 4:/ }).click()
  await expect(page.getByRole('button', { name: /^칸 1: 4 노랑/ })).toBeVisible()
  await page.getByRole('radio', { name: '세로 이어붙이기' }).click()
  await page.getByRole('spinbutton', { name: '간격', exact: true }).fill('10')
  await page.getByRole('checkbox', { name: /바깥 여백/ }).uncheck()
  await page.getByRole('radio', { name: '배경색: 흰색' }).click()
  await page.getByRole('radio', { name: 'JPG' }).click()
  // 1080 wide: 노랑 810 + 초록 (turned, 3:2) 720 + 파랑 1080 + 빨강 720 + 3 gaps.
  await expect(page.getByTestId('collage-size')).toHaveText('1080 × 3360 px · JPG')
  await expect(saveButton).toBeEnabled()
  await saveButton.click()
  await expect(page.getByRole('status')).toContainText('합친 사진 저장 완료 · 4 노랑_collage.jpg')
  const stack = jpeg.decode(await readFile(join(output, '4 노랑_collage.jpg')), { useTArray: true })
  expect([stack.width, stack.height]).toEqual([1080, 3360])
  near(rgb(stack, 540, 405), YELLOW); near(rgb(stack, 540, 820 + 360), GREEN); near(rgb(stack, 540, 1550 + 540), BLUE); near(rgb(stack, 540, 2640 + 360), RED)
  near(rgb(stack, 540, 815), [255, 255, 255], 6)
  near(rgb(stack, 3, 405), YELLOW) // no outer margin
  expect((await readdir(output)).sort()).toEqual(['1 빨강_collage.png', '1 빨강_collage_1.png', '4 노랑_collage.jpg'])

  // Main refuses forged requests: unknown photo, size mismatch, non-PNG bytes.
  const forged = await page.evaluate(async () => {
    const photoId = crypto.randomUUID()
    const canvas = new OffscreenCanvas(4, 4); canvas.getContext('2d')!.fillRect(0, 0, 4, 4)
    const png = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())
    return Promise.all([
      window.photokkumi.saveCollage({ photoId, png, format: 'png', width: 4, height: 4 }),
      window.photokkumi.saveCollage({ photoId: '../../etc/passwd'.padEnd(36, 'x'), png, format: 'png', width: 4, height: 4 }),
      (window.photokkumi.saveCollage as (request: unknown) => Promise<{ ok: boolean }>)({ photoId, png, format: 'png', width: 4, height: 4, path: '/tmp' })
    ])
  })
  expect(forged.map(item => item.ok)).toEqual([false, false, false])
  // A real photo id with a size that does not match the PNG is refused too.
  await select(paths)
  const mismatch = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(4, 4); canvas.getContext('2d')!.fillRect(0, 0, 4, 4)
    const png = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())
    const photo = await window.photokkumi.choosePhotos()
    return { photos: photo.ok, result: photo.ok && photo.value ? await window.photokkumi.saveCollage({ photoId: photo.value[0].id, png, format: 'png', width: 5, height: 4 }) : null }
  })
  expect(mismatch.result).toEqual({ ok: false, error: '합친 사진의 크기가 요청과 다릅니다.' })
  expect(await page.locator('.photo-item').count()).toBe(4)

  // The smallest window: five mode tabs and the collage panel fit without clipping or scrolling.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(760, 580))
  await expect.poll(() => page.evaluate(() => window.innerHeight)).toBe(580)
  const layout = await page.evaluate(() => {
    const overflow = (element: Element | null) => !!element && element.scrollHeight > element.clientHeight + 1
    const tabs = [...document.querySelectorAll('.mode-tabs button')]
    const toolbar = document.querySelector('.toolbar')!
    return {
      page: document.documentElement.scrollHeight > window.innerHeight || document.documentElement.scrollWidth > window.innerWidth,
      aside: overflow(document.querySelector('.collage-side')), panel: overflow(document.querySelector('.collage-panel')),
      toolbar: toolbar.scrollWidth > toolbar.clientWidth + 1 || toolbar.getBoundingClientRect().height > 52,
      tabs: tabs.some(item => item.scrollWidth > item.clientWidth + 1),
      stage: document.querySelector('[data-testid=collage-stage]')!.getBoundingClientRect().height,
      // Free space under the last panel row: headroom for Windows' taller Malgun Gothic.
      spare: Math.round(document.querySelector('.collage-panel')!.getBoundingClientRect().bottom - document.querySelector('.collage-panel')!.lastElementChild!.getBoundingClientRect().bottom)
    }
  })
  test.info().annotations.push({ type: 'min-window', description: JSON.stringify(layout) })
  await page.screenshot({ path: test.info().outputPath('collage-minimum-window.png') })
  expect(layout).toMatchObject({ page: false, aside: false, panel: false, toolbar: false, tabs: false })
  expect(layout.stage).toBeGreaterThan(200)
  expect(layout.spare).toBeGreaterThanOrEqual(16)
  expect(await page.getByRole('tab', { name: '사진 합치기' }).evaluate(element => (element as HTMLElement).innerText)).toBe('합치기')
  await expect(saveButton).toBeInViewport()
  await expect(page.getByRole('button', { name: '빼기', exact: true })).toBeInViewport()
  // The fifth tab still leaves the photo editor's and thumbnail's one-row toolbars room at 760 px.
  for (const tab of [page.getByRole('tab').first(), page.getByRole('tab', { name: /썸네일/ })]) {
    await tab.click()
    await expect(tab).toHaveAttribute('aria-selected', 'true')
    const bar = await page.evaluate(() => {
      const toolbar = document.querySelector('.toolbar')!
      const spacer = [...toolbar.querySelectorAll('.toolbar-spacer')].find(item => (item as HTMLElement).offsetParent)
      return { wide: toolbar.scrollWidth > toolbar.clientWidth + 1, tall: toolbar.getBoundingClientRect().height > 52, spare: spacer?.getBoundingClientRect().width ?? 0 }
    })
    expect({ wide: bar.wide, tall: bar.tall }).toEqual({ wide: false, tall: false })
    // Windows' Malgun Gothic is wider than the macOS fonts: keep room here so the Windows toolbar still fits.
    if (process.platform === 'darwin') expect(bar.spare).toBeGreaterThanOrEqual(80)
  }

  // Originals are byte-for-byte unchanged.
  expect(await Promise.all(paths.map(async path => hash(await readFile(path))))).toEqual(before)
})
