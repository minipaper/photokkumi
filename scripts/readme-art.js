/* global OffscreenCanvas */
// Runs inside a Chromium page: draws synthetic sample photos and stickers, returns PNG bytes.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- called from the screenshot script via page.evaluate
async function art() {
  const out = {}
  const bytes = async c => [...new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())]
  // ---------- photos ----------
  function sky(g, W, H, top, bottom) { const s = g.createLinearGradient(0, 0, 0, H); s.addColorStop(0, top); s.addColorStop(1, bottom); g.fillStyle = s; g.fillRect(0, 0, W, H) }
  function cloud(g, x, y, s) { g.fillStyle = 'rgba(255,255,255,.92)'; for (const [dx, dy, r] of [[0, 0, 40], [45, -18, 52], [100, 0, 42], [50, 14, 46]]) { g.beginPath(); g.arc(x + dx * s, y + dy * s, r * s, 0, 7); g.fill() } }
  function hills(g, W, H, base, amp, color, seed) { g.fillStyle = color; g.beginPath(); g.moveTo(0, H); for (let x = 0; x <= W; x += 8) g.lineTo(x, base + Math.sin(x / 260 + seed) * amp + Math.sin(x / 90 + seed * 2) * amp * .25); g.lineTo(W, H); g.fill() }
  function tree(g, x, y, s, leaf) { g.fillStyle = '#6b4a2f'; g.fillRect(x - 9 * s, y - 70 * s, 18 * s, 80 * s); g.fillStyle = leaf; for (const [dx, dy, r] of [[0, -120, 60], [-40, -90, 48], [40, -90, 48], [0, -70, 50]]) { g.beginPath(); g.arc(x + dx * s, y + dy * s, r * s, 0, 7); g.fill() } }
  function person(g, x, y, s, shirt, hair) {
    g.fillStyle = shirt; g.beginPath(); g.roundRect(x - 55 * s, y - 40 * s, 110 * s, 190 * s, 50 * s); g.fill()
    g.fillStyle = '#f2c9a5'; g.beginPath(); g.arc(x, y - 95 * s, 58 * s, 0, 7); g.fill()
    g.fillStyle = hair; g.beginPath(); g.arc(x, y - 110 * s, 60 * s, Math.PI * 1.02, Math.PI * 1.98); g.fill()
    g.fillStyle = '#3b2a20'; for (const dx of [-20, 20]) { g.beginPath(); g.arc(x + dx * s, y - 92 * s, 6 * s, 0, 7); g.fill() }
    g.strokeStyle = '#a8553f'; g.lineWidth = 5 * s; g.beginPath(); g.arc(x, y - 78 * s, 16 * s, .2, Math.PI - .2); g.stroke()
  }
  async function park(W, H, palette) {
    const c = new OffscreenCanvas(W, H), g = c.getContext('2d')
    sky(g, W, H * .7, palette.top, palette.bottom)
    g.fillStyle = palette.sun; g.beginPath(); g.arc(W * .8, H * .18, H * .07, 0, 7); g.fill()
    cloud(g, W * .12, H * .14, H / 700); cloud(g, W * .5, H * .1, H / 900)
    hills(g, W, H, H * .52, H * .05, palette.far, 1); hills(g, W, H, H * .62, H * .04, palette.near, 3)
    g.fillStyle = '#d9c8a0'; g.beginPath(); g.moveTo(W * .42, H); g.quadraticCurveTo(W * .55, H * .75, W * .62, H * .62); g.lineTo(W * .66, H * .62); g.quadraticCurveTo(W * .62, H * .8, W * .7, H); g.fill()
    for (const [x, sc] of [[.08, 1.2], [.22, .9], [.88, 1.1], [.76, .7]]) tree(g, W * x, H * .7, sc * H / 900, palette.leaf)
    person(g, W * .36, H * .66, H / 900, '#ef7b6b', '#3a2a22'); person(g, W * .5, H * .7, H / 1000, '#5b8def', '#24201c')
    return bytes(c)
  }
  async function street(W, H) {
    const c = new OffscreenCanvas(W, H), g = c.getContext('2d')
    sky(g, W, H * .5, '#9fd3ff', '#e6f4ff')
    const blds = [['#e8b4a0', .0, .3], ['#c9d6e8', .26, .22], ['#f0d9a8', .46, .28], ['#b9d8c2', .72, .28]]
    for (const [col, x, top] of blds) { g.fillStyle = col; g.fillRect(W * x, H * top, W * .27, H * .7); g.fillStyle = 'rgba(255,255,255,.7)'; for (let r = 0; r < 4; r++) for (let k = 0; k < 3; k++) g.fillRect(W * x + 30 + k * W * .08, H * top + 40 + r * 90, W * .05, 55) }
    g.fillStyle = '#7d7f86'; g.fillRect(0, H * .78, W, H * .22); g.fillStyle = '#b5b7bb'; g.fillRect(0, H * .74, W, H * .05)
    // shop sign
    g.fillStyle = '#2f4858'; g.beginPath(); g.roundRect(W * .5, H * .44, W * .2, H * .08, 12); g.fill(); g.fillStyle = '#fff'; g.font = `bold ${H * .045}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('CAFE', W * .6, H * .48)
    // car with plate
    const cx = W * .18, cy = H * .7; g.fillStyle = '#e2564f'; g.beginPath(); g.roundRect(cx, cy, W * .34, H * .13, 30); g.fill(); g.beginPath(); g.roundRect(cx + W * .06, cy - H * .08, W * .2, H * .1, 30); g.fill()
    g.fillStyle = '#cfe8ff'; g.fillRect(cx + W * .08, cy - H * .065, W * .07, H * .06); g.fillRect(cx + W * .165, cy - H * .065, W * .07, H * .06)
    g.fillStyle = '#222'; for (const dx of [.07, .27]) { g.beginPath(); g.arc(cx + W * dx, cy + H * .13, H * .045, 0, 7); g.fill() }
    g.fillStyle = '#fff'; g.fillRect(cx + W * .12, cy + H * .06, W * .1, H * .045); g.strokeStyle = '#333'; g.lineWidth = 3; g.strokeRect(cx + W * .12, cy + H * .06, W * .1, H * .045)
    g.fillStyle = '#111'; g.font = `bold ${H * .032}px sans-serif`; g.fillText('12가 3456', cx + W * .17, cy + H * .083)
    person(g, W * .82, H * .66, H / 900, '#8c6be0', '#2b2420')
    return bytes(c)
  }
  async function table(W, H) {
    const c = new OffscreenCanvas(W, H), g = c.getContext('2d')
    const wood = g.createLinearGradient(0, 0, W, H); wood.addColorStop(0, '#c8955e'); wood.addColorStop(1, '#a8743f'); g.fillStyle = wood; g.fillRect(0, 0, W, H)
    g.strokeStyle = 'rgba(80,40,10,.15)'; g.lineWidth = 3; for (let y = 20; y < H; y += 46) { g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(W * .3, y + 14, W * .6, y - 14, W, y + 6); g.stroke() }
    g.fillStyle = '#fff'; g.beginPath(); g.arc(W * .35, H * .5, H * .22, 0, 7); g.fill(); g.fillStyle = '#6b3e1f'; g.beginPath(); g.arc(W * .35, H * .5, H * .17, 0, 7); g.fill(); g.fillStyle = '#f5e6cf'; g.beginPath(); g.ellipse(W * .35, H * .5, H * .08, H * .05, .4, 0, 7); g.fill()
    g.fillStyle = '#fbe3e8'; g.beginPath(); g.arc(W * .7, H * .48, H * .2, 0, 7); g.fill(); g.fillStyle = '#f7b7c4'; g.fillRect(W * .62, H * .38, W * .16, H * .16); g.fillStyle = '#e8495f'; g.beginPath(); g.arc(W * .7, H * .36, H * .03, 0, 7); g.fill()
    return bytes(c)
  }
  out['산책.png'] = await park(1600, 1067, { top: '#7ec4f5', bottom: '#d9efff', sun: '#ffd666', far: '#8fc79a', near: '#6fb27c', leaf: '#4f9a5d' })
  out['노을.png'] = await park(1600, 1067, { top: '#f6a07a', bottom: '#ffe0b5', sun: '#fff1c9', far: '#c08f7c', near: '#9e7366', leaf: '#6f7d4f' })
  out['거리.png'] = await street(1600, 1067)
  out['카페.png'] = await table(1600, 1067)
  out['세로 산책.png'] = await park(1067, 1600, { top: '#86b9f0', bottom: '#e8f3ff', sun: '#ffe08a', far: '#9cc5a0', near: '#78b085', leaf: '#5a9f66' })
  // ---------- stickers ----------
  const S = 256
  function sticker(draw) { const c = new OffscreenCanvas(S, S), g = c.getContext('2d'); g.lineJoin = 'round'; draw(g); return bytes(c) }
  const outline = (g, fill, w = 10) => { g.fillStyle = fill; g.fill(); g.strokeStyle = '#fff'; g.lineWidth = w; g.stroke() }
  out['하트.png'] = await sticker(g => { g.beginPath(); g.moveTo(128, 214); g.bezierCurveTo(20, 140, 20, 50, 80, 46); g.bezierCurveTo(108, 44, 124, 64, 128, 80); g.bezierCurveTo(132, 64, 148, 44, 176, 46); g.bezierCurveTo(236, 50, 236, 140, 128, 214); g.closePath(); outline(g, '#ff5c8a') })
  out['별.png'] = await sticker(g => { g.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 50 : 112, a = -Math.PI / 2 + i * Math.PI / 5; g.lineTo(128 + r * Math.cos(a), 134 + r * Math.sin(a)) } g.closePath(); outline(g, '#ffcc3d') })
  out['스마일.png'] = await sticker(g => { g.beginPath(); g.arc(128, 128, 110, 0, 7); outline(g, '#ffd84a'); g.fillStyle = '#4a3420'; for (const x of [92, 164]) { g.beginPath(); g.ellipse(x, 104, 12, 18, 0, 0, 7); g.fill() } g.strokeStyle = '#4a3420'; g.lineWidth = 12; g.lineCap = 'round'; g.beginPath(); g.arc(128, 132, 58, .3, Math.PI - .3); g.stroke(); g.fillStyle = 'rgba(255,120,120,.5)'; for (const x of [70, 186]) { g.beginPath(); g.arc(x, 150, 16, 0, 7); g.fill() } })
  out['곰.png'] = await sticker(g => { g.fillStyle = '#b07a4f'; for (const x of [56, 200]) { g.beginPath(); g.arc(x, 62, 40, 0, 7); outline(g, '#b07a4f', 8) } g.beginPath(); g.arc(128, 142, 100, 0, 7); outline(g, '#b07a4f'); g.fillStyle = '#f0d2b0'; g.beginPath(); g.ellipse(128, 172, 44, 34, 0, 0, 7); g.fill(); g.fillStyle = '#3a2618'; for (const x of [90, 166]) { g.beginPath(); g.arc(x, 128, 11, 0, 7); g.fill() } g.beginPath(); g.ellipse(128, 160, 14, 10, 0, 0, 7); g.fill() })
  out['꽃.png'] = await sticker(g => { for (let i = 0; i < 5; i++) { const a = i * Math.PI * 2 / 5 - Math.PI / 2; g.beginPath(); g.arc(128 + 62 * Math.cos(a), 128 + 62 * Math.sin(a), 52, 0, 7); outline(g, '#ff9ec4', 8) } g.beginPath(); g.arc(128, 128, 40, 0, 7); outline(g, '#ffd23f', 8) })
  out['구름.png'] = await sticker(g => { g.beginPath(); g.arc(80, 150, 50, Math.PI * .5, Math.PI * 1.5); g.arc(118, 96, 56, Math.PI, Math.PI * 1.9); g.arc(176, 118, 52, Math.PI * 1.3, Math.PI * .5); g.closePath(); outline(g, '#bfe3ff') })
  out['반짝.png'] = await sticker(g => { const star = (x, y, r) => { g.beginPath(); g.moveTo(x, y - r); g.quadraticCurveTo(x, y, x + r, y); g.quadraticCurveTo(x, y, x, y + r); g.quadraticCurveTo(x, y, x - r, y); g.quadraticCurveTo(x, y, x, y - r); outline(g, '#ffe66b', 6) }; star(110, 120, 90); star(200, 60, 40); star(196, 196, 30) })
  out['말풍선.png'] = await sticker(g => { g.beginPath(); g.roundRect(18, 40, 220, 140, 60); g.moveTo(80, 170); g.lineTo(60, 230); g.lineTo(130, 176); outline(g, '#ffffff', 0); g.strokeStyle = '#5b4bd1'; g.lineWidth = 8; g.beginPath(); g.roundRect(18, 40, 220, 140, 60); g.stroke(); g.fillStyle = '#5b4bd1'; g.font = 'bold 62px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('LOVE', 128, 112) })
  out['리본.png'] = await sticker(g => { for (const s of [-1, 1]) { g.beginPath(); g.moveTo(128, 128); g.bezierCurveTo(128 + s * 60, 40, 128 + s * 130, 70, 128 + s * 110, 140); g.bezierCurveTo(128 + s * 100, 190, 128 + s * 50, 150, 128, 128); outline(g, '#ff6f91', 8) } g.beginPath(); g.arc(128, 128, 26, 0, 7); outline(g, '#ff4f7b', 8) })
  return out
}
