import { fontFamilyList, type FontRef } from '../shared/fonts'
import { stickerIcon } from '../shared/sticker-icons'
import { bodyLines, designById, parseMarks, type Segment, type StickerContent, type StickerSpec } from '../shared/sticker-maker'

/**
 * Sticker maker drawing: each design is a small tree of measured boxes (text runs, icons, shapes) stacked
 * around its content, drawn on a transparent canvas and trimmed to the painted pixels.
 * The panel preview, the gallery cards and the saved PNG all come from renderSticker().
 */
export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
export interface Box { w: number; h: number; draw(c: Ctx, x: number, y: number): void }
type Paint = (c: Ctx, x: number, y: number, w: number, h: number) => void

const channels = (hex: string) => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16))
export const rgba = (hex: string, alpha: number) => `rgba(${channels(hex).join(', ')}, ${alpha})`
export function mix(a: string, b: string, t: number) {
  const x = channels(a), y = channels(b)
  return `#${x.map((value, index) => Math.round(value + (y[index] - value) * t).toString(16).padStart(2, '0')).join('')}`
}
export function luminance(hex: string) {
  const [r, g, b] = channels(hex).map(value => { const v = value / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
/** Colors derived from the two the user picks: text ink and accent. */
export function stickerColors(ink: string, accent: string) {
  const light = luminance(accent) > 0.45
  return {
    ink, accent,
    /** Accent used for text and thin lines on a white page: light accents (yellow, mint) are deepened to stay readable. */
    text: light ? mix(accent, '#000000', 0.32) : accent,
    soft: mix(accent, '#ffffff', 0.8),
    on: light ? '#26282d' : '#ffffff',
    deep: mix(accent, '#000000', 0.25),
    muted: mix(ink, '#ffffff', 0.3),
    line: mix(ink, '#ffffff', 0.62)
  }
}
type Colors = ReturnType<typeof stickerColors>

const box = (w: number, h: number, draw: Box['draw'] = () => undefined): Box => ({ w, h, draw })
const spacer = (w: number, h: number) => box(w, h)
function vstack(items: Box[], gap: number, align: 'center' | 'left' = 'center'): Box {
  const shown = items.filter(item => item.w > 0 || item.h > 0)
  const w = Math.max(0, ...shown.map(item => item.w))
  const h = shown.reduce((sum, item) => sum + item.h, 0) + gap * Math.max(0, shown.length - 1)
  return box(w, h, (c, x, y) => {
    let top = y
    for (const item of shown) { item.draw(c, align === 'center' ? x + (w - item.w) / 2 : x, top); top += item.h + gap }
  })
}
function hstack(items: Box[], gap: number): Box {
  const shown = items.filter(item => item.w > 0)
  const h = Math.max(0, ...shown.map(item => item.h))
  const w = shown.reduce((sum, item) => sum + item.w, 0) + gap * Math.max(0, shown.length - 1)
  return box(w, h, (c, x, y) => {
    let left = x
    for (const item of shown) { item.draw(c, left, y + (h - item.h) / 2); left += item.w + gap }
  })
}
/** Padding around a box, with optional paint under (background) and over (decoration) it. */
function pad(inner: Box, px: number, py: number, under?: Paint, over?: Paint): Box {
  const w = inner.w + px * 2, h = inner.h + py * 2
  return box(w, h, (c, x, y) => { under?.(c, x, y, w, h); inner.draw(c, x + px, y + py); over?.(c, x, y, w, h) })
}

interface TextLook {
  size: number; color: string; weight?: 400 | 700
  /** How [marked] runs look: colored text, a highlighter bar behind, dots above each letter, or the same as the rest. */
  mark?: 'color' | 'marker' | 'dots' | 'none'
  markColor?: string; markWeight?: 400 | 700
  /** Line box height in font sizes. */
  leading?: number
}
interface Run { text: string; size: number; weight: 400 | 700; color: string; marker?: string; dots?: string }
const fontCss = (font: FontRef, weight: number, size: number) => `${weight} ${size}px ${fontFamilyList(font)}`

/** One line of runs on a shared baseline (mixed sizes line up at the bottom of the letters). */
function runsBox(c: Ctx, font: FontRef, runs: Run[], leading = 1.5): Box {
  const sized = runs.filter(run => run.text).map(run => { c.font = fontCss(font, run.weight, run.size); return { ...run, width: c.measureText(run.text).width } })
  const max = Math.max(0, ...sized.map(run => run.size))
  const w = sized.reduce((sum, run) => sum + run.width, 0)
  const h = max * leading
  return box(w, h, (c, x, y) => {
    // Hangul sits about 0.38 em above the alphabetic baseline at its middle.
    const baseline = y + h / 2 + max * 0.36
    let left = x
    for (const run of sized) {
      if (run.marker) {
        c.fillStyle = run.marker
        c.fillRect(left - run.size * 0.06, baseline - run.size * 0.36, run.width + run.size * 0.12, run.size * 0.46)
      }
      c.font = fontCss(font, run.weight, run.size)
      c.textAlign = 'left'; c.textBaseline = 'alphabetic'
      c.fillStyle = run.color
      c.fillText(run.text, left, baseline)
      if (run.dots) {
        c.fillStyle = run.dots
        let before = ''
        for (const char of run.text) {
          const start = c.measureText(before).width, end = c.measureText(before + char).width
          if (char.trim()) { c.beginPath(); c.arc(left + (start + end) / 2, baseline - run.size * 0.93, run.size * 0.06, 0, Math.PI * 2); c.fill() }
          before += char
        }
      }
      left += run.width
    }
  })
}
function textBox(c: Ctx, font: FontRef, segments: Segment[], look: TextLook): Box {
  const weight = look.weight ?? 400, mark = look.mark ?? 'color', markColor = look.markColor ?? look.color
  const runs: Run[] = segments.map(segment => !segment.mark || mark === 'none'
    ? { text: segment.text, size: look.size, weight, color: look.color }
    : { text: segment.text, size: look.size, weight: look.markWeight ?? weight,
      color: mark === 'marker' ? look.color : markColor,
      marker: mark === 'marker' ? markColor : undefined, dots: mark === 'dots' ? markColor : undefined })
  return runsBox(c, font, runs, look.leading)
}
/** Several lines; an empty line keeps its height. `rules` draws a thin line under every line across the block. */
function paragraph(c: Ctx, font: FontRef, lines: Segment[][], look: TextLook, align: 'center' | 'left' = 'center', rules?: { color: string; width: number; extra: number }): Box {
  const boxes = lines.map(line => line.length ? textBox(c, font, line, look) : spacer(0, look.size * (look.leading ?? 1.5)))
  if (!rules) return vstack(boxes, 0, align)
  const inner = vstack(boxes, 0, align)
  const w = inner.w + rules.extra * 2
  return box(w, inner.h, (c, x, y) => {
    c.strokeStyle = rules.color; c.lineWidth = rules.width; c.setLineDash([])
    let top = y
    for (const line of boxes) {
      top += line.h
      c.beginPath(); c.moveTo(x, top - rules.width / 2); c.lineTo(x + w, top - rules.width / 2); c.stroke()
    }
    inner.draw(c, x + rules.extra, y)
  })
}
function iconBox(id: string, size: number, color: string, weight = 1.8): Box {
  const icon = stickerIcon(id)
  if (!icon) return spacer(0, 0)
  return box(size, size, (c, x, y) => {
    c.save()
    c.translate(x, y); c.scale(size / 24, size / 24)
    c.strokeStyle = color; c.lineWidth = weight; c.lineCap = 'round'; c.lineJoin = 'round'; c.setLineDash([])
    c.stroke(new Path2D(icon.d))
    c.restore()
  })
}
/** Icon inside a filled circle. */
function iconDisc(id: string, diameter: number, fill: string, color: string): Box {
  const icon = iconBox(id, diameter * 0.6, color, 2)
  if (!icon.w) return spacer(0, 0)
  return box(diameter, diameter, (c, x, y) => {
    c.fillStyle = fill; c.beginPath(); c.arc(x + diameter / 2, y + diameter / 2, diameter / 2, 0, Math.PI * 2); c.fill()
    icon.draw(c, x + diameter * 0.2, y + diameter * 0.2)
  })
}
const line = (w: number, h: number, color: string, thickness: number, dash: number[] = []) => box(w, h, (c, x, y) => {
  c.strokeStyle = color; c.lineWidth = thickness; c.lineCap = 'round'; c.setLineDash(dash)
  c.beginPath(); c.moveTo(x + thickness / 2, y + h / 2); c.lineTo(x + w - thickness / 2, y + h / 2); c.stroke(); c.setLineDash([])
})
const fillRound = (color: string, radius: (w: number, h: number) => number): Paint => (c, x, y, w, h) => {
  c.fillStyle = color; c.beginPath(); c.roundRect(x, y, w, h, radius(w, h)); c.fill()
}

interface Kit { c: Ctx; u: number; font: FontRef; k: Colors; content: StickerContent; title: Segment[]; body: Segment[][] }
const has = (segments: Segment[]) => segments.some(segment => segment.text.trim())
const bodyText = (kit: Kit, look: Partial<TextLook> = {}, align: 'center' | 'left' = 'center') =>
  paragraph(kit.c, kit.font, kit.body, { size: kit.u, color: kit.k.ink, mark: 'color', markColor: kit.k.text, ...look }, align)
const titleText = (kit: Kit, look: Partial<TextLook>) => has(kit.title) ? textBox(kit.c, kit.font, kit.title, { size: kit.u, color: kit.k.ink, weight: 700, mark: 'color', markColor: kit.k.text, ...look }) : spacer(0, 0)
const iconOf = (kit: Kit, size: number, color: string, weight?: number) => kit.content.icon ? iconBox(kit.content.icon, size, color, weight) : spacer(0, 0)
function caption(kit: Kit, withIcon = false) {
  const text = parseMarks(kit.content.caption)
  if (!has(text)) return spacer(0, 0)
  return hstack([withIcon ? iconOf(kit, kit.u * 0.8, kit.k.text) : spacer(0, 0),
    textBox(kit.c, kit.font, text, { size: kit.u * 0.72, color: kit.k.muted, mark: 'color', markColor: kit.k.text })], kit.u * 0.22)
}
/** Masking tape: translucent strip with torn (zigzag) ends, slightly tilted. */
const tape = (color: string, tooth: number): Paint => (c, x, y, w, h) => {
  c.save()
  c.translate(x + w / 2, y + h / 2); c.rotate(-2.5 * Math.PI / 180)
  const left = -w / 2, right = w / 2, top = -h / 2, teeth = Math.max(3, Math.round(h / (tooth * 2)))
  c.fillStyle = color; c.beginPath(); c.moveTo(left, top); c.lineTo(right, top)
  for (let i = 0; i < teeth; i++) { const step = h / teeth; c.lineTo(right - tooth, top + step * (i + 0.5)); c.lineTo(right, top + step * (i + 1)) }
  c.lineTo(left, top + h)
  for (let i = teeth - 1; i >= 0; i--) { const step = h / teeth; c.lineTo(left + tooth, top + step * (i + 0.5)); c.lineTo(left, top + step * i) }
  c.closePath(); c.fill(); c.restore()
}

const BUILDERS: Record<string, (kit: Kit) => Box> = {
  'n-plain': kit => bodyText(kit),
  'n-dots': kit => bodyText(kit, { mark: 'dots' }),
  'n-marker': kit => bodyText(kit, { mark: 'marker', markColor: rgba(kit.k.accent, 0.34), markWeight: 700 }),
  'n-pill': kit => {
    const { u, k } = kit
    const label = hstack([iconOf(kit, u * 0.95, k.text), titleText(kit, { size: u * 0.92, leading: 1.4 })], u * 0.28)
    const pill = label.w ? pad(label, u * 0.75, u * 0.28, fillRound(k.soft, (_, h) => h / 2)) : spacer(0, 0)
    return vstack([pill, bodyText(kit)], u * 0.55)
  },
  'n-tape': kit => {
    const { u, k } = kit
    const label = titleText(kit, { size: u, leading: 1.4 })
    const strip = label.w ? pad(label, u * 1.0, u * 0.3, tape(rgba(k.accent, 0.3), u * 0.16)) : spacer(0, 0)
    return vstack([strip, bodyText(kit)], u * 0.5)
  },
  'n-icon': kit => {
    const { c, u, k, font } = kit
    const head = hstack([iconOf(kit, u * 1.25, k.text), titleText(kit, { size: u * 1.05 })], u * 0.35)
    const body = paragraph(c, font, kit.body, { size: u, color: k.ink, mark: 'color', markColor: k.text, leading: 1.75 }, 'center', { color: rgba(k.accent, 0.45), width: Math.max(1, u * 0.05), extra: u * 0.5 })
    return vstack([head, body], u * 0.35)
  },
  'n-box': kit => {
    const { u, k } = kit
    const label = hstack([iconOf(kit, u * 0.95, k.text), titleText(kit, { size: u * 0.95, color: k.text, leading: 1.3 })], u * 0.25)
    const inner = bodyText(kit)
    const top = label.w ? label.h / 2 : 0
    const w = Math.max(inner.w + u * 2, label.w + u * 3), h = top + inner.h + u * 1.7
    const thickness = Math.max(1.5, u * 0.075), r = u * 0.6
    return box(w, h, (c, x, y) => {
      const t = thickness / 2, left = x + t, right = x + w - t, upper = y + top, lower = y + h - t
      const gap = label.w ? label.w / 2 + u * 0.35 : 0, mid = x + w / 2
      c.strokeStyle = k.accent; c.lineWidth = thickness; c.lineJoin = 'round'; c.setLineDash([])
      c.beginPath()
      c.moveTo(mid + gap, upper); c.lineTo(right - r, upper); c.arcTo(right, upper, right, upper + r, r)
      c.lineTo(right, lower - r); c.arcTo(right, lower, right - r, lower, r)
      c.lineTo(left + r, lower); c.arcTo(left, lower, left, lower - r, r)
      c.lineTo(left, upper + r); c.arcTo(left, upper, left + r, upper, r)
      c.lineTo(mid - gap, upper); c.stroke()
      label.draw(c, mid - label.w / 2, y)
      inner.draw(c, x + (w - inner.w) / 2, upper + u * 0.85)
    })
  },
  'n-card': kit => {
    const { u, k } = kit
    const head = hstack([kit.content.icon ? iconDisc(kit.content.icon, u * 1.45, k.accent, k.on) : spacer(0, 0), titleText(kit, { size: u })], u * 0.4)
    const body = bodyText(kit)
    const gap = head.w ? u * 0.9 : 0
    const inner = box(Math.max(head.w, body.w), head.h + gap + body.h, (c, x, y) => {
      const w = Math.max(head.w, body.w)
      head.draw(c, x + (w - head.w) / 2, y)
      if (head.w) line(w, gap, rgba(k.accent, 0.55), Math.max(1, u * 0.06), [u * 0.18, u * 0.18]).draw(c, x, y + head.h)
      body.draw(c, x + (w - body.w) / 2, y + head.h + gap)
    })
    return pad(inner, u * 1.1, u * 0.85, fillRound(k.soft, () => u * 0.7))
  },
  'n-side': kit => {
    const { u, k } = kit
    const head = hstack([iconOf(kit, u * 1.05, k.text), titleText(kit, { size: u * 0.98, color: k.text, leading: 1.35 })], u * 0.28)
    const content = vstack([head, bodyText(kit, {}, 'left')], u * 0.2, 'left')
    const bar = u * 0.2
    return box(content.w + bar + u * 0.65, content.h, (c, x, y) => {
      c.fillStyle = k.accent; c.beginPath(); c.roundRect(x, y + u * 0.15, bar, content.h - u * 0.3, bar / 2); c.fill()
      content.draw(c, x + bar + u * 0.65, y)
    })
  },
  'n-badge': kit => {
    const { u, k } = kit
    const label = hstack([iconOf(kit, u * 1.0, k.on, 2), titleText(kit, { size: u, color: k.on, mark: 'none', leading: 1.35 })], u * 0.28)
    return label.w ? pad(label, u * 0.8, u * 0.32, fillRound(k.accent, (_, h) => h / 2)) : spacer(0, 0)
  },

  'h-quote': kit => {
    const { c, u, k, font } = kit
    const big = u * 1.6
    const marked = kit.title.some(segment => segment.mark)
    const runs: Run[] = (marked ? kit.title : kit.title.map(segment => ({ ...segment, mark: true }))).filter(segment => segment.text.trim() || !segment.mark)
      .map(segment => segment.mark ? { text: `‘${segment.text.trim()}’`, size: big, weight: 700, color: k.ink } : { text: segment.text, size: u * 0.95, weight: 400, color: k.muted })
    const title = runs.length ? runsBox(c, font, runs, 1.35) : spacer(0, 0)
    const rule = title.w ? line(title.w + u * 0.8, u * 0.35, k.line, Math.max(1, u * 0.06)) : spacer(0, 0)
    return vstack([title, rule, caption(kit, true)], u * 0.12)
  },
  'h-icon-top': kit => {
    const { u, k } = kit
    const title = titleText(kit, { size: u * 1.5, leading: 1.4 })
    const marked = title.w ? pad(title, u * 0.25, 0, (c, x, y, w, h) => { c.fillStyle = rgba(k.accent, 0.3); c.fillRect(x, y + h * 0.5, w, h * 0.32) }) : spacer(0, 0)
    const chevron = box(u * 0.45, u * 0.45, (c, x, y) => {
      c.strokeStyle = k.muted; c.lineWidth = Math.max(1, u * 0.06); c.lineCap = 'round'; c.lineJoin = 'round'; c.setLineDash([])
      c.beginPath(); c.moveTo(x + u * 0.05, y + u * 0.13); c.lineTo(x + u * 0.225, y + u * 0.32); c.lineTo(x + u * 0.4, y + u * 0.13); c.stroke()
    })
    const text = caption(kit)
    return vstack([iconOf(kit, u * 1.9, k.text, 1.6), marked, text.w ? hstack([chevron, text, chevron], u * 0.25) : text], u * 0.22)
  },
  'h-icon-left': kit => {
    const { u, k } = kit
    const top = hstack([kit.content.icon ? iconDisc(kit.content.icon, u * 1.75, k.soft, k.text) : spacer(0, 0), titleText(kit, { size: u * 1.4, leading: 1.35 })], u * 0.4)
    const rule = top.w ? line(top.w + u * 0.4, u * 0.4, k.accent, Math.max(1.5, u * 0.09)) : spacer(0, 0)
    return vstack([top, rule, caption(kit)], u * 0.1)
  },
  'h-line': kit => {
    const { u, k } = kit
    const title = titleText(kit, { size: u * 1.3, leading: 1.4 })
    const side = line(u * 2.2, u, k.accent, Math.max(1.5, u * 0.07))
    const row = title.w ? hstack([side, title, side], u * 0.5) : spacer(0, 0)
    return vstack([iconOf(kit, u * 1.3, k.text), row, caption(kit)], u * 0.12)
  },
  'h-bubble': kit => {
    const { u, k } = kit
    const label = hstack([iconOf(kit, u * 1.15, k.on, 2), titleText(kit, { size: u * 1.25, color: k.on, mark: 'none', leading: 1.35 })], u * 0.3)
    if (!label.w) return caption(kit)
    const inner = pad(label, u * 0.95, u * 0.35)
    const tail = u * 0.45
    const bubble = box(inner.w, inner.h + tail, (c, x, y) => {
      c.fillStyle = k.accent; c.beginPath(); c.roundRect(x, y, inner.w, inner.h, inner.h / 2); c.fill()
      c.beginPath(); c.moveTo(x + inner.w / 2 - tail * 0.8, y + inner.h - 1); c.lineTo(x + inner.w / 2, y + inner.h + tail); c.lineTo(x + inner.w / 2 + tail * 0.8, y + inner.h - 1); c.closePath(); c.fill()
      inner.draw(c, x, y)
    })
    return vstack([bubble, caption(kit)], u * 0.3)
  },
  'h-tab': kit => {
    const { u, k } = kit
    const text = caption(kit)
    const row = hstack([iconOf(kit, u * 1.15, k.text), titleText(kit, { size: u * 1.15, leading: 1.4 }), text.w ? spacer(u * 0.3, 1) : spacer(0, 0), text], u * 0.35)
    const bar = u * 0.2
    return pad(row, u * 0.95, u * 0.4, (c, x, y, w, h) => {
      c.fillStyle = k.soft; c.beginPath(); c.roundRect(x, y, w, h, u * 0.3); c.fill()
      c.fillStyle = k.accent; c.beginPath(); c.roundRect(x, y, bar, h, [u * 0.3, 0, 0, u * 0.3]); c.fill()
    })
  },

  'e-ribbon': kit => {
    const { u, k } = kit
    const label = titleText(kit, { size: u * 1.2, color: k.on, mark: 'none', leading: 1.35 })
    if (!label.w) return caption(kit)
    const center = pad(label, u * 1.1, u * 0.35)
    const tailW = u * 1.4, overlap = u * 0.55, drop = u * 0.38, side = tailW - overlap
    const ribbon = box(center.w + side * 2, center.h + drop, (c, x, y) => {
      const ch = center.h, cl = x + side, cr = cl + center.w
      c.fillStyle = k.deep
      for (const [outer, inner] of [[x, cl + overlap], [x + side * 2 + center.w, cr - overlap]]) {
        const notch = outer < inner ? outer + u * 0.42 : outer - u * 0.42
        c.beginPath(); c.moveTo(outer, y + drop); c.lineTo(inner, y + drop); c.lineTo(inner, y + drop + ch); c.lineTo(outer, y + drop + ch); c.lineTo(notch, y + drop + ch / 2); c.closePath(); c.fill()
      }
      c.fillStyle = mix(k.accent, '#000000', 0.45)
      c.beginPath(); c.moveTo(cl, y + ch); c.lineTo(cl + overlap, y + ch); c.lineTo(cl + overlap, y + ch + drop); c.closePath(); c.fill()
      c.beginPath(); c.moveTo(cr, y + ch); c.lineTo(cr - overlap, y + ch); c.lineTo(cr - overlap, y + ch + drop); c.closePath(); c.fill()
      c.fillStyle = k.accent; c.fillRect(cl, y, center.w, ch)
      center.draw(c, cl, y)
    })
    return vstack([ribbon, caption(kit)], u * 0.45)
  },
  'e-thanks': kit => {
    const { u, k } = kit
    const title = titleText(kit, { size: u * 1.15, leading: 1.4 })
    const row = title.w ? hstack([iconOf(kit, u * 1.1, k.text), title, iconOf(kit, u * 1.1, k.text)], u * 0.45) : spacer(0, 0)
    const dots = row.w ? line(row.w, u * 0.45, rgba(k.accent, 0.7), Math.max(1.5, u * 0.09), [0.01, u * 0.32]) : spacer(0, 0)
    return vstack([row, dots, caption(kit)], u * 0.1)
  },
  'e-bookmark': kit => {
    const { u, k } = kit
    const title = titleText(kit, { size: u * 1.2, color: k.text, mark: 'none', leading: 1.3 })
    const inner = vstack([iconOf(kit, u * 1.1, k.text), title], u * 0.15)
    if (!inner.w) return caption(kit)
    const notch = u * 0.7, w = Math.max(inner.w + u * 1.4, u * 3.6), h = inner.h + u * 1.2 + notch, spark = u * 0.9
    const mark = box(w + spark * 2, h + u * 0.3, (c, x, y) => {
      const left = x + spark, top = y + u * 0.3, thickness = Math.max(1.5, u * 0.08)
      c.fillStyle = k.soft; c.strokeStyle = k.accent; c.lineWidth = thickness; c.lineJoin = 'round'; c.setLineDash([])
      c.beginPath(); c.moveTo(left, top); c.lineTo(left + w, top); c.lineTo(left + w, top + h); c.lineTo(left + w / 2, top + h - notch); c.lineTo(left, top + h); c.closePath(); c.fill(); c.stroke()
      // Short rays at the two top corners.
      c.lineCap = 'round'; c.strokeStyle = k.text
      for (const [cx, dir] of [[left - u * 0.15, -1], [left + w + u * 0.15, 1]] as const) {
        for (const angle of [-60, -25, 10]) {
          const a = (dir < 0 ? 180 - angle : angle) * Math.PI / 180
          c.beginPath(); c.moveTo(cx + Math.cos(a) * u * 0.25, top + Math.sin(a) * u * 0.25); c.lineTo(cx + Math.cos(a) * u * 0.6, top + Math.sin(a) * u * 0.6); c.stroke()
        }
      }
      inner.draw(c, left + (w - inner.w) / 2, top + u * 0.6)
    })
    return vstack([mark, caption(kit)], u * 0.35)
  }
}

/** The measured layout of a sticker (no pixels yet). */
export function buildSticker(c: Ctx, spec: StickerSpec): Box {
  const design = designById(spec.design)
  const builder = design && BUILDERS[design.id]
  if (!builder) throw new Error('알 수 없는 스티커 디자인입니다.')
  const fields = new Set(design.fields)
  const content: StickerContent = {
    title: fields.has('title') ? spec.content.title : '', body: fields.has('body') ? spec.content.body : '',
    caption: fields.has('caption') ? spec.content.caption : '', icon: fields.has('icon') ? spec.content.icon : ''
  }
  const kit: Kit = { c, u: spec.style.size, font: spec.style.font, k: stickerColors(spec.style.ink, spec.style.accent), content,
    title: parseMarks(content.title.trim()), body: bodyLines(content.body).map(parseMarks) }
  return builder(kit)
}
export const MAX_STICKER_SIDE = 4096
export const MAX_STICKER_AREA = 4_000_000
/** Smallest rectangle holding pixels with alpha above `threshold`; null when nothing is painted. */
export function opaqueBounds(data: Uint8ClampedArray, width: number, height: number, threshold = 4) {
  let left = width, right = -1, top = height, bottom = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > threshold) {
        if (x < left) left = x
        if (x > right) right = x
        if (y < top) top = y
        bottom = y
      }
    }
  }
  return right < 0 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
}
/**
 * Draws the sticker with a generous margin (tilted tape, glyph overhang), then crops to the painted pixels
 * plus a small even border. Returns null when the fields are empty.
 */
export function renderSticker(spec: StickerSpec, scale = 1): HTMLCanvasElement | null {
  const work = document.createElement('canvas')
  const context = work.getContext('2d')
  if (!context) throw new Error('Canvas를 만들 수 없습니다.')
  const scaled = { ...spec, style: { ...spec.style, size: spec.style.size * scale } }
  const layout = buildSticker(context, scaled)
  if (layout.w < 1 || layout.h < 1) return null
  const margin = Math.ceil(scaled.style.size * 1.2)
  const width = Math.ceil(layout.w + margin * 2), height = Math.ceil(layout.h + margin * 2)
  if (width > MAX_STICKER_SIDE + margin * 2 || height > MAX_STICKER_SIDE + margin * 2 || width * height > MAX_STICKER_AREA * 2) throw new Error('스티커가 너무 큽니다. 글자 수나 크기를 줄여 주세요.')
  work.width = width; work.height = height
  layout.draw(context, margin, margin)
  const bounds = opaqueBounds(context.getImageData(0, 0, width, height).data, width, height)
  if (!bounds) return null
  const border = Math.max(2, Math.round(scaled.style.size * 0.2))
  const out = document.createElement('canvas')
  out.width = bounds.width + border * 2; out.height = bounds.height + border * 2
  if (out.width > MAX_STICKER_SIDE || out.height > MAX_STICKER_SIDE || out.width * out.height > MAX_STICKER_AREA) throw new Error('스티커가 너무 큽니다. 글자 수나 크기를 줄여 주세요.')
  out.getContext('2d')!.drawImage(work, bounds.x, bounds.y, bounds.width, bounds.height, border, border, bounds.width, bounds.height)
  return out
}
export async function stickerPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('PNG를 만들지 못했습니다.')
  return new Uint8Array(await blob.arrayBuffer())
}
