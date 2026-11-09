// Builds the app icons from a square source PNG: build/icon.png (1024) and build/icon.ico (16–256).
// Usage: npm run icon -- <source.png>
// A source whose corners are already transparent is used as-is. The 2026-11 draft has an opaque gray
// backdrop and drop shadow, so its rounded tile (measured bounds below) is cut out with an anti-aliased mask.
import { PNG } from 'pngjs'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { Buffer } from 'node:buffer'
import console from 'node:console'
import { fileURLToPath } from 'node:url'
const src = process.argv[2], outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'build')
if (!src) { console.error('usage: npm run icon -- <source.png>'); process.exit(1) }
const p = PNG.sync.read(fs.readFileSync(src))
const transparent = p.data[3] < 10 && p.data[(p.width * p.height - 1) * 4 + 3] < 10
const [L, R, T, B, RAD] = transparent ? [0, p.width, 0, p.height, 0] : [426, 1622, 404, 1662, 250]
if (!transparent && (p.width !== 2048 || p.height !== 2048)) { console.error('opaque source must be the 2048px draft; export a transparent PNG instead'); process.exit(1) }
const coverage = (x, y) => { // 4x4 supersampled inside test
  let hit = 0
  for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
    const px = x + (sx + 0.5) / 4, py = y + (sy + 0.5) / 4
    if (px < L || px > R || py < T || py > B) continue
    const cx = Math.min(Math.max(px, L + RAD), R - RAD), cy = Math.min(Math.max(py, T + RAD), B - RAD)
    if ((px - cx) ** 2 + (py - cy) ** 2 <= RAD * RAD) hit++
  }
  return hit / 16
}
const cover = transparent ? () => 1 : coverage
const tileW = R - L, tileH = B - T, side = transparent ? Math.max(tileW, tileH) : Math.round(tileH / 0.94)
const ox = Math.round((side - tileW) / 2), oy = Math.round((side - tileH) / 2)
// Premultiplied float buffer of the square canvas.
const big = new Float64Array(side * side * 4)
for (let y = T - 1; y <= B + 1; y++) for (let x = L - 1; x <= R + 1; x++) {
  if (x < 0 || y < 0 || x >= p.width || y >= p.height) continue
  const a = cover(x, y) * p.data[(y * p.width + x) * 4 + 3] / 255; if (!a) continue
  const i = (y * p.width + x) * 4, j = ((y - T + oy) * side + (x - L + ox)) * 4
  big[j] = p.data[i] * a; big[j + 1] = p.data[i + 1] * a; big[j + 2] = p.data[i + 2] * a; big[j + 3] = 255 * a
}
function resize(buf, from, to) { // exact area averaging, separable
  const weights = []
  for (let o = 0; o < to; o++) {
    const a = o * from / to, b = (o + 1) * from / to, w = []
    for (let k = Math.floor(a); k < Math.ceil(b); k++) w.push([k, Math.min(b, k + 1) - Math.max(a, k)])
    weights.push(w)
  }
  const tmp = new Float64Array(to * from * 4)
  for (let y = 0; y < from; y++) for (let o = 0; o < to; o++) for (const [k, w] of weights[o]) for (let c = 0; c < 4; c++) tmp[(y * to + o) * 4 + c] += buf[(y * from + k) * 4 + c] * w
  const out = new Float64Array(to * to * 4)
  for (let o = 0; o < to; o++) for (const [k, w] of weights[o]) for (let x = 0; x < to; x++) for (let c = 0; c < 4; c++) out[(o * to + x) * 4 + c] += tmp[(k * to + x) * 4 + c] * w
  const scale = (to / from) ** 2, png = new PNG({ width: to, height: to })
  for (let i = 0; i < to * to; i++) {
    const a = out[i * 4 + 3] * scale
    for (let c = 0; c < 3; c++) png.data[i * 4 + c] = a > 0 ? Math.round(Math.min(255, out[i * 4 + c] * scale / a * 255)) : 0
    png.data[i * 4 + 3] = Math.round(Math.min(255, a))
  }
  return PNG.sync.write(png)
}
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'icon.png'), resize(big, side, 1024))
// ICO with PNG-compressed entries (Windows Vista+), 16–256px.
const sizes = [16, 24, 32, 48, 64, 128, 256], images = sizes.map(s => resize(big, side, s))
const header = Buffer.alloc(6 + 16 * sizes.length); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4)
let offset = header.length
sizes.forEach((s, n) => {
  const e = 6 + n * 16
  header.writeUInt8(s >= 256 ? 0 : s, e); header.writeUInt8(s >= 256 ? 0 : s, e + 1); header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6)
  header.writeUInt32LE(images[n].length, e + 8); header.writeUInt32LE(offset, e + 12); offset += images[n].length
})
fs.writeFileSync(path.join(outDir, 'icon.ico'), Buffer.concat([header, ...images]))
console.log('wrote build/icon.png and build/icon.ico')
