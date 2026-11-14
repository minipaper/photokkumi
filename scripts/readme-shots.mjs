import { _electron as electron } from '@playwright/test'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { Buffer } from 'node:buffer'
import { URL } from 'node:url'
// Regenerates docs/images/*.png from synthetic art: npm run build && npm run shots (needs ffmpeg for the GIF shot; resizing uses macOS sips).
const ROOT = process.cwd(), OUT = resolve(ROOT, 'docs/images-raw'), W = 1280, H = 800
const dir = await mkdtemp(join(tmpdir(), 'pk-readme-')), saved = join(dir, '결과'); await mkdir(saved); await mkdir(OUT, { recursive: true })
const launch = (profile = 'profile') => electron.launch({ args: ['--force-device-scale-factor=2', resolve(ROOT, 'out/main/index.js'), `--user-data-dir=${join(dir, profile)}`], env: { ...process.env, ELECTRON_RENDERER_URL: '', PHOTOKKUMI_DEFAULT_STICKERS: 'none' } })
let app = await launch(), page = await app.firstWindow()
await app.evaluate(({ BrowserWindow }, [w, h]) => { const b = BrowserWindow.getAllWindows()[0]; b.setContentSize(w, h); b.center() }, [W, H])
await page.getByRole('button', { name: '사진 열기', exact: true }).waitFor()
// Synthetic artwork drawn by Chromium canvas (no real photos).
const src = await readFile(new URL('./readme-art.js', import.meta.url), 'utf8')
const files = await page.evaluate(`(async () => { ${src}; return art() })()`)
const path = name => join(dir, name)
for (const [name, data] of Object.entries(files)) await writeFile(path(name), Buffer.from(data))
const pick = async p => app.evaluate(({ dialog }, s) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: s }) }, p)
const shot = async (name, clip) => page.screenshot({ path: join(OUT, name), ...(clip ? { clip } : {}) })
const field = async (name, v) => { const f = page.getByRole('spinbutton', { name, exact: true }); await f.fill(String(v)); await f.press('Tab') }
const photos = ['산책.png', '거리.png', '카페.png', '노을.png', '세로 산책.png'].map(path)
await pick(photos); await page.getByRole('button', { name: '사진 열기', exact: true }).click(); await page.waitForTimeout(800)
const stickers = ['하트', '별', '스마일', '곰', '꽃', '구름', '반짝', '말풍선', '리본'].map(n => path(n + '.png'))
await pick(stickers); await page.getByRole('button', { name: '스티커 관리', exact: true }).click()
await page.getByRole('button', { name: 'PNG 등록', exact: true }).click(); await page.waitForTimeout(900)
await page.getByRole('button', { name: '관리 닫기', exact: true }).click(); await page.waitForTimeout(300)
const open = page.getByRole('button', { name: '위치·크기 숫자로 조정', exact: true })
const place = async (name, x, y, w, r = 0) => {
  await page.getByRole('button', { name: `${name} 배치`, exact: true }).click(); await page.waitForTimeout(200)
  if (await open.getAttribute('aria-expanded') !== 'true') await open.click()
  await field('중심 X', x); await field('중심 Y', y); await field('스티커 너비', w); if (r) await field('회전', r)
}
// Photo 1: cover two faces, add a sparkle; save it so the strip shows a finished photo.
await place('스마일', 576, 592, 175, -8)
await place('곰', 800, 640, 170, 6)
await place('반짝', 1000, 470, 150)
await pick([saved]); await page.keyboard.press('ControlOrMeta+s'); await page.waitForTimeout(1200)
await open.click() // fold numbers again for a calmer panel
await page.mouse.click(10, 10)
await page.locator('button', { hasText: '2. 곰' }).click(); await page.waitForTimeout(300)
await page.mouse.move(W / 2, H - 60)
await shot('edit.png')
// Photo 2: hide the plate (mosaic, rectangle) and a face (blur, round).
await page.getByRole('button', { name: '사진 2: 거리.png' }).click(); await page.waitForTimeout(600)
await page.getByRole('tab', { name: /^가림/ }).click()
const box = await page.locator('.canvas-area canvas').first().boundingBox()
const draw = async (dx, dy) => { const x = box.x + box.width / 2 + dx, y = box.y + box.height / 2 + dy; await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 60, y + 40, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(250) }
await page.getByRole('spinbutton', { name: '가림 강도', exact: true }).fill('80')
await draw(150, -150)
if (await open.getAttribute('aria-expanded') !== 'true') await open.click()
await field('중심 X', 1312); await field('중심 Y', 592); await field('영역 너비', 170); await field('영역 높이', 170)
await page.mouse.click(box.x + box.width / 2 - 300, box.y + 120); await page.waitForTimeout(200) // click on empty photo: deselect
await page.getByRole('radio', { name: '▭ 사각형' }).click(); await page.getByRole('radio', { name: '모자이크' }).click()
await page.getByRole('spinbutton', { name: '가림 강도', exact: true }).fill('60')
await draw(-200, 120)
await field('중심 X', 560); await field('중심 Y', 835); await field('영역 너비', 200); await field('영역 높이', 76)
await page.evaluate('document.activeElement?.blur()')
await page.waitForTimeout(500)
await shot('blur.png')
// Photo 4: a caption and a date tag with bundled fonts.
await page.getByRole('button', { name: '사진 4: 노을.png' }).click()
await page.getByRole('button', { name: '버리기', exact: true }).first().click(); await page.waitForTimeout(600) // photo 2 was only for the blur shot
const caption = page.getByRole('textbox', { name: '글자 내용' })
const addText = async (text, preset, font, size, x, y) => {
  await page.getByRole('button', { name: '글자 넣기' }).click()
  await caption.waitFor(); await page.waitForFunction("document.activeElement?.getAttribute('aria-label') === '글자 내용'")
  await page.keyboard.type(text)
  await page.getByRole('button', { name: `스타일: ${preset}` }).click()
  await page.getByRole('combobox', { name: '글꼴' }).selectOption(font); await page.waitForTimeout(300)
  if (await open.getAttribute('aria-expanded') !== 'true') await open.click()
  await field('글자 크기', size); await field('중심 X', x); await field('중심 Y', y)
}
await addText('오늘의 노을', '그림자만', 'jua', 150, 800, 260)
await addText('2026. 11 · 한강 산책', '반투명 검은 상자', 'pretendard', 52, 800, 930)
await open.click()
await page.getByRole('button', { name: /^글자 1:/ }).click()
await page.evaluate('document.activeElement?.blur()')
await page.mouse.move(W / 2, H - 60); await page.waitForTimeout(500)
await shot('text.png')
// Crop tool on the same photo with a 1:1 box; Esc leaves the photo uncut for the thumbnail shot.
await page.getByRole('tab', { name: /^자르기/ }).click()
await page.getByRole('radio', { name: /^1:1/ }).click()
await page.mouse.move(W / 2, H - 60); await page.waitForTimeout(500)
await shot('crop.png')
await page.keyboard.press('Escape')
await page.getByRole('tab', { name: '스티커' }).click()
await page.keyboard.press('Escape')
// Thumbnail: the open photo as background, a template, a new title.
await page.getByRole('tab', { name: '썸네일 만들기' }).click()
await page.getByRole('button', { name: '템플릿: 형광펜 강조' }).click(); await page.waitForTimeout(400)
await page.getByRole('tab', { name: /^글자/ }).click()
await page.getByRole('button', { name: /^글자 2:/ }).click()
await caption.fill('한강 노을 맛집'); await page.evaluate('document.activeElement?.blur()')
await page.getByRole('tab', { name: '템플릿' }).click()
await page.mouse.move(W / 2, H - 60); await page.waitForTimeout(600)
await shot('thumb.png')
// GIF from a short synthetic clip (pan over the park picture).
const clip = join(dir, '산책 영상.mp4')
spawnSync('ffmpeg', ['-loglevel', 'error', '-loop', '1', '-i', path('산책.png'), '-vf', "scale=1600:-2,zoompan=z='1.0+0.002*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=180:s=1280x720:fps=30", '-t', '6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip])
await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
app = await launch('profile-gif'); page = await app.firstWindow()
await app.evaluate(({ BrowserWindow }, [w, h]) => { const b = BrowserWindow.getAllWindows()[0]; b.setContentSize(w, h); b.center() }, [W, H])
await page.getByRole('tab', { name: 'GIF 만들기' }).click()
await pick([clip]); await page.getByRole('button', { name: '동영상 열기' }).click()
await page.getByTestId('gif-frame').waitFor({ timeout: 30000 })
await page.getByRole('spinbutton', { name: '끝 시간' }).fill('4.5'); await page.getByRole('spinbutton', { name: '시작 시간' }).fill('1')
await page.waitForTimeout(800)
await shot('gif.png')
await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
for (const name of ['edit', 'blur', 'text', 'crop', 'thumb', 'gif']) spawnSync('sips', ['-Z', '1600', join(OUT, name + '.png'), '--out', resolve(ROOT, 'docs/images', name + '.png')])
process.stdout.write('done\n')
process.exit(0)
