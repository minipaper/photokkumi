/**
 * Auto level (자동 수평): finds how far the photo's straight lines (horizon, buildings, tables, window frames)
 * lean from horizontal/vertical, so the straighten tool can cancel it. No model or library: edge directions
 * from a Sobel filter, then a small Hough vote over candidate tilts in which lines must also be collinear.
 *
 * Tilt is in degrees clockwise on screen (image y grows downward): a horizon whose right end sits lower leans +α,
 * and straightening by −α levels it. Horizontal lines count fully; vertical ones half, because looking up at a
 * building makes its verticals converge and would mislead the estimate.
 */
export interface GrayImage { data: Uint8Array | Uint8ClampedArray; width: number; height: number; channels: 1 | 4 }
/** Search range: phone photos are rarely more than a few degrees off; wider ranges catch diagonals by mistake. */
export const LEVEL_RANGE = 15
const STEP = 0.1
/** A point only votes for tilts within this many degrees of its own edge direction. */
const LOCAL_SPREAD = 2
const VERTICAL_WEIGHT = 0.5
/** The best line must gather edge pixels along at least this share of the image's short side to be trusted. */
const MIN_LINE_SHARE = 0.25

export interface LevelResult { tilt: number; strength: number }

function luminance(image: GrayImage): Float32Array {
  const { data, width, height, channels } = image
  const out = new Float32Array(width * height)
  if (channels === 1) { for (let i = 0; i < out.length; i++) out[i] = data[i]; return out }
  for (let i = 0; i < out.length; i++) out[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
  return out
}

/** Returns the lean of the photo's dominant straight lines, or null when no line is clear enough to trust. */
export function estimateTilt(image: GrayImage): LevelResult | null {
  const { width, height } = image
  if (width < 16 || height < 16) return null
  const gray = luminance(image)
  // Edge points: position, local line direction (degrees, folded to the nearest axis) and family.
  const xs: number[] = [], ys: number[] = [], tilts: number[] = [], vertical: boolean[] = []
  const magnitudes = new Float32Array(width * height)
  let maxMagnitude = 0
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x
    const gx = gray[i - width + 1] + 2 * gray[i + 1] + gray[i + width + 1] - gray[i - width - 1] - 2 * gray[i - 1] - gray[i + width - 1]
    const gy = gray[i + width - 1] + 2 * gray[i + width] + gray[i + width + 1] - gray[i - width - 1] - 2 * gray[i - width] - gray[i - width + 1]
    const magnitude = Math.hypot(gx, gy)
    magnitudes[i] = magnitude
    if (magnitude > maxMagnitude) maxMagnitude = magnitude
  }
  // Strong edges only: faint texture (grass, noise, skin) points every way and only blurs the vote.
  const threshold = Math.max(60, maxMagnitude * 0.25)
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x
    if (magnitudes[i] < threshold) continue
    const gx = gray[i - width + 1] + 2 * gray[i + 1] + gray[i + width + 1] - gray[i - width - 1] - 2 * gray[i - 1] - gray[i + width - 1]
    const gy = gray[i + width - 1] + 2 * gray[i + width] + gray[i + width + 1] - gray[i - width - 1] - 2 * gray[i - width] - gray[i - width + 1]
    // The line runs perpendicular to the gradient; fold its direction into (−90°, 90°].
    let line = Math.atan2(gy, gx) * 180 / Math.PI - 90
    while (line <= -90) line += 180
    while (line > 90) line -= 180
    if (Math.abs(line) <= LEVEL_RANGE + LOCAL_SPREAD) { xs.push(x); ys.push(y); tilts.push(line); vertical.push(false) }
    else if (Math.abs(line) >= 90 - LEVEL_RANGE - LOCAL_SPREAD) { xs.push(x); ys.push(y); tilts.push(line > 0 ? line - 90 : line + 90); vertical.push(true) }
  }
  if (!xs.length) return null
  // Hough vote: for each candidate tilt, project the points that agree with it onto the line normal (1px bins).
  // Many points on one thin line → a tall bin; Σ bin² rewards long collinear runs over scattered matches.
  const steps = Math.round(LEVEL_RANGE / STEP)
  const diagonal = Math.ceil(Math.hypot(width, height)) + 2
  const bins = new Float32Array(diagonal * 2)
  // Unweighted point counts per bin: the trust check measures real line length whatever the family.
  const counts = new Uint32Array(diagonal * 2)
  let best = { tilt: 0, score: -1, peak: 0 }
  const scores = new Float64Array(steps * 2 + 1)
  for (let k = -steps; k <= steps; k++) {
    const tilt = k * STEP, radians = tilt * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians)
    bins.fill(0); counts.fill(0)
    const touched: number[] = []
    for (let p = 0; p < xs.length; p++) {
      if (Math.abs(tilts[p] - tilt) > LOCAL_SPREAD) continue
      // Horizontal family: distance along the normal (−sin, cos); vertical family: along (cos, sin).
      const rho = vertical[p] ? xs[p] * cos + ys[p] * sin : -xs[p] * sin + ys[p] * cos
      const bin = Math.round(rho) + diagonal
      if (bins[bin] === 0) touched.push(bin)
      bins[bin] += vertical[p] ? VERTICAL_WEIGHT : 1
      counts[bin]++
    }
    let score = 0, peak = 0
    for (const bin of touched) { score += bins[bin] * bins[bin]; if (counts[bin] > peak) peak = counts[bin] }
    scores[k + steps] = score
    if (score > best.score) best = { tilt, score, peak }
  }
  // Sobel marks both sides of a thin line, so a line of length L gathers about 2L in a 1px bin; halve to compare.
  const shortSide = Math.min(width, height)
  if (best.peak / 2 < shortSide * MIN_LINE_SHARE) return null
  // Sub-step refinement: a parabola through the peak and its neighbours.
  const index = Math.round(best.tilt / STEP) + steps
  let tilt = best.tilt
  if (index > 0 && index < scores.length - 1) {
    const left = scores[index - 1], mid = scores[index], right = scores[index + 1], curve = left - 2 * mid + right
    if (curve < 0) tilt += STEP * Math.max(-0.5, Math.min(0.5, (left - right) / (2 * curve)))
  }
  return { tilt: Math.round(tilt * 10) / 10, strength: best.peak / 2 / shortSide }
}
