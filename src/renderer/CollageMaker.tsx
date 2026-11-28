import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { PhotoInfo } from '../shared/model'
import {
  COLLAGE_BACKGROUNDS, COLLAGE_LAYOUTS, COLLAGE_WIDTHS, DEFAULT_COLLAGE, cellCount, MAX_GAP, MAX_RADIUS, MAX_ZOOM, STACK_MAX, arrangeCells, layoutById, panView, placePhoto,
  planCollage, removeCell, swapCells, updateView, validCollageOptions, zoomView,
  type CellView, type CollageCell, type CollageLayoutId, type CollageOptions, type CollagePlan, type Size
} from '../shared/collage'
import { cellPath, drawCell, renderCollage, type CollageSource } from './collage-draw'
import { loadPref, savePref } from './remember'
import { ColorField } from './TextPanel'

interface Props {
  active: boolean
  photos: PhotoInfo[]
  outputFolder: string | null
  /** Identity of a photo's current edits; a different value means its preview is out of date. */
  editsOf(id: string): unknown
  /** Quarter turns of a photo, for its strip thumbnail. */
  turnOf(id: string): number | undefined
  /** The photo as the editor would save it (edits applied, original resolution). The caller closes the bitmap. */
  renderPhoto(id: string): Promise<ImageBitmap>
  onSaved(folderLabel: string): void
  onStatus(text: string): void
  onError(text: string): void
  onBusyChange(busy: boolean): void
}
const OPTIONS_KEY = 'pk.collage'
/** Long edge of the cached preview copy of each photo. */
const PREVIEW_EDGE = 1200
interface Cached extends CollageSource { edits: unknown }

/** Small pictogram of a layout, drawn from its real plan. */
function LayoutIcon({ layout }: { layout: CollageLayoutId }) {
  const plan = planCollage({ layout, width: 240, gap: 24, margin: false, radius: 0 }, [{ width: 10, height: 4 }, { width: 10, height: 4 }, { width: 10, height: 4 }])
  const size = Math.max(plan.width, plan.height)
  return <svg width="22" height="22" viewBox={`${(plan.width - size) / 2} ${(plan.height - size) / 2} ${size} ${size}`} aria-hidden="true">
    {plan.cells.map((cell, index) => <rect key={index} x={cell.x} y={cell.y} width={cell.width} height={cell.height} rx="14" fill="currentColor" fillOpacity={index ? 0.55 : 0.9} />)}
  </svg>
}

export function CollageMaker({ active, photos, outputFolder, editsOf, turnOf, renderPhoto, onSaved, onStatus, onError, onBusyChange }: Props) {
  const api = window.photokkumi
  const [options, setOptions] = useState<CollageOptions>(() => loadPref(OPTIONS_KEY, DEFAULT_COLLAGE, validCollageOptions))
  const [cells, setCells] = useState<CollageCell[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [swapFrom, setSwapFrom] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [, setVersion] = useState(0)
  const busy = loading || saving
  useEffect(() => { onBusyChange(busy) }, [busy, onBusyChange])
  useEffect(() => { savePref(OPTIONS_KEY, options) }, [options])
  const change = (patch: Partial<CollageOptions>) => setOptions(current => ({ ...current, ...patch }))

  // Cells follow the layout and the photo list: placed photos stay, removed ones leave, empty cells take unused photos.
  const photoIds = useMemo(() => photos.map(item => item.id), [photos])
  useEffect(() => {
    if (!active) return
    setCells(current => arrangeCells(current, options.layout, photoIds))
    setSelected(current => current !== null && current < cellCount(options.layout, STACK_MAX) ? current : null)
    setSwapFrom(null)
  }, [active, options.layout, photoIds])

  // Preview copies of the edited photos, redrawn when a photo's edits change. One at a time: reading photos shares main's lock.
  const cache = useRef(new Map<string, Cached>())
  const failed = useRef(new Map<string, unknown>())
  const pumping = useRef(false)
  const wanted = useRef<string[]>([])
  const latest = useRef({ editsOf, renderPhoto, onError })
  latest.current = { editsOf, renderPhoto, onError }
  const stale = (id: string) => { const entry = cache.current.get(id); return (!entry || entry.edits !== latest.current.editsOf(id)) && failed.current.get(id) !== latest.current.editsOf(id) }
  const pump = useCallback(async () => {
    if (pumping.current) return
    pumping.current = true; setLoading(true)
    try {
      for (let id = wanted.current.find(stale); id; id = wanted.current.find(stale)) {
        const edits = latest.current.editsOf(id)
        try {
          const full = await latest.current.renderPhoto(id)
          const width = full.width, height = full.height, ratio = Math.min(1, PREVIEW_EDGE / Math.max(width, height))
          let bitmap = full
          if (ratio < 1) {
            try { bitmap = await createImageBitmap(full, { resizeWidth: Math.max(1, Math.round(width * ratio)), resizeHeight: Math.max(1, Math.round(height * ratio)), resizeQuality: 'high' }) }
            finally { full.close() }
          }
          cache.current.get(id)?.bitmap.close()
          cache.current.set(id, { edits, bitmap, width, height })
          failed.current.delete(id)
        } catch (error) {
          failed.current.set(id, edits)
          latest.current.onError(error instanceof Error ? error.message : '사진을 불러오지 못했습니다.')
        }
        setVersion(value => value + 1)
      }
    } finally { pumping.current = false; setLoading(false) }
  }, [])
  useEffect(() => {
    wanted.current = [...new Set(cells.map(cell => cell.photoId).filter((id): id is string => !!id))]
    // Only photos in a cell keep a preview copy.
    for (const [id, entry] of cache.current) if (!wanted.current.includes(id)) { entry.bitmap.close(); cache.current.delete(id) }
    if (active) void pump()
  }, [active, cells, pump])
  useEffect(() => () => { for (const entry of cache.current.values()) entry.bitmap.close(); cache.current.clear() }, [])

  // Real (edited) photo sizes for the stack; the photo's opened size stands in until its preview is ready.
  const sizeOf = (id: string | null): Size => {
    const entry = id ? cache.current.get(id) : undefined
    if (entry) return entry
    const info = photos.find(item => item.id === id)
    if (!info) return { width: 4, height: 3 }
    return (turnOf(info.id) ?? 0) % 2 ? { width: info.height, height: info.width } : info
  }
  let plan: CollagePlan | null = null, planError = ''
  try { if (cells.length) plan = planCollage(options, options.layout === 'stack' ? cells.map(cell => sizeOf(cell.photoId)) : []) }
  catch (error) { planError = error instanceof Error ? error.message : '합칠 수 없습니다.' }

  // Preview: the same plan drawn scaled into the available area.
  const stage = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [room, setRoom] = useState<Size>({ width: 1, height: 1 })
  useEffect(() => {
    const node = stage.current
    if (!node) return
    const observer = new ResizeObserver(() => setRoom({ width: node.clientWidth, height: node.clientHeight }))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const scale = plan ? Math.min(1, Math.max(1, room.width - 32) / plan.width, Math.max(1, room.height - 32) / plan.height) : 1
  useEffect(() => {
    const node = canvas.current, context = node?.getContext('2d')
    if (!node || !context || !plan) return
    const ratio = window.devicePixelRatio || 1
    node.width = Math.max(1, Math.round(plan.width * scale * ratio)); node.height = Math.max(1, Math.round(plan.height * scale * ratio))
    context.setTransform(scale * ratio, 0, 0, scale * ratio, 0, 0)
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high'
    context.fillStyle = options.background
    context.fillRect(0, 0, plan.width, plan.height)
    plan.cells.forEach((rect, index) => {
      const cell = cells[index], entry = cell?.photoId ? cache.current.get(cell.photoId) : undefined
      if (entry && cell) { drawCell(context, rect, entry, cell.view, plan.radius); return }
      cellPath(context, rect, plan.radius)
      context.fillStyle = '#c9ced8'; context.fill()
      context.fillStyle = '#6b7280'; context.font = `${Math.round(28 / scale)}px system-ui, sans-serif`; context.textAlign = 'center'; context.textBaseline = 'middle'
      context.fillText(cell?.photoId ? '…' : '+', rect.x + rect.width / 2, rect.y + rect.height / 2)
    })
  })

  // Drag inside a cell pans its photo; the wheel zooms it.
  const drag = useRef<{ index: number; x: number; y: number; view: CellView; pointer: number } | null>(null)
  const sourceSize = (index: number) => { const id = cells[index]?.photoId; return id ? cache.current.get(id) : undefined }
  const pickCell = (index: number) => {
    if (swapFrom !== null) {
      if (swapFrom !== index) { setCells(current => swapCells(current, swapFrom, index)); onStatus(`${swapFrom + 1}번과 ${index + 1}번 칸을 바꿨습니다.`) }
      setSwapFrom(null); setSelected(index); return
    }
    setSelected(index)
  }
  const pointerDown = (index: number, event: PointerEvent<HTMLButtonElement>) => {
    if (busy || event.button !== 0) return
    pickCell(index)
    const cell = cells[index]
    if (!cell || swapFrom !== null) return
    drag.current = { index, x: event.clientX, y: event.clientY, view: cell.view, pointer: event.pointerId }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const pointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const current = drag.current, source = current && sourceSize(current.index)
    if (!current || current.pointer !== event.pointerId || !source || !plan) return
    const next = panView(current.view, source, plan.cells[current.index], (event.clientX - current.x) / scale, (event.clientY - current.y) / scale)
    setCells(cellsNow => updateView(cellsNow, current.index, next))
  }
  const pointerUp = (event: PointerEvent<HTMLButtonElement>) => { if (drag.current?.pointer === event.pointerId) drag.current = null }
  const setZoom = (index: number, zoom: number) => {
    const cell = cells[index]
    if (!cell) return
    setCells(current => updateView(current, index, zoomView(cell.view, zoom)))
  }
  const cellKey = (index: number, event: KeyboardEvent<HTMLButtonElement>) => {
    const source = sourceSize(index), step = event.shiftKey ? 50 : 10
    const offset: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    if (offset[event.key] && source && plan) {
      event.preventDefault()
      setCells(current => updateView(current, index, panView(current[index].view, source, plan.cells[index], ...offset[event.key])))
    } else if (event.key === '+' || event.key === '=') { event.preventDefault(); setZoom(index, cells[index].view.zoom * 1.1) }
    else if (event.key === '-') { event.preventDefault(); setZoom(index, cells[index].view.zoom / 1.1) }
    else if (event.key === 'Escape') { setSwapFrom(null); setSelected(null) }
  }

  const choosePhoto = (id: string) => {
    if (busy) return
    const placed = placePhoto(cells, options.layout, selected, id)
    if (!placed) { onStatus(options.layout === 'stack' ? `세로 이어붙이기는 ${STACK_MAX}장까지입니다.` : '바꿀 칸을 먼저 누르세요.'); return }
    setCells(placed.cells); setSelected(placed.index); setSwapFrom(null)
  }

  const missing = cells.some(cell => !cell.photoId)
  const canSave = !busy && !!plan && !missing && photos.length > 0
  const save = async () => {
    if (!canSave || !plan) return
    setSaving(true); onError('')
    try {
      onStatus('합친 사진을 만드는 중…')
      const png = await renderCollage(plan, options.background, cells, async id => { const bitmap = await renderPhoto(id); return { bitmap, width: bitmap.width, height: bitmap.height } })
      const result = await api.saveCollage({ photoId: cells[0].photoId!, png, format: options.format, width: plan.width, height: plan.height })
      if (!result.ok) throw new Error(result.error)
      if (!result.value) { onStatus('저장이 취소되었습니다.'); return }
      onSaved(result.value.folderLabel)
      onStatus(`합친 사진 저장 완료 · ${result.value.name}`)
    } catch (error) { onStatus(''); onError(error instanceof Error ? error.message : '합친 사진을 저장하지 못했습니다.') }
    finally { setSaving(false) }
  }
  const saveShortcut = useRef(save)
  saveShortcut.current = save
  useEffect(() => {
    if (!active) return
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 's' || event.repeat) return
      if (document.querySelector('dialog[open]')) return
      event.preventDefault(); void saveShortcut.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])

  const layout = layoutById(options.layout)
  const nameOf = (id: string | null) => photos.find(item => item.id === id)?.name ?? '빈 칸'
  const current = selected !== null ? cells[selected] : undefined
  const sizeLabel = plan ? `${plan.width} × ${plan.height} px${plan.scale < 1 ? ' (한도에 맞춰 줄임)' : ''}` : '-'

  return <div className="collage-host">
    <div className="maker-workspace" aria-label="사진 합치기">
      <div className="maker-main">
        <div className="collage-stage" ref={stage} data-testid="collage-stage">
          {!photos.length ? <p className="hint">사진 편집 탭에서 사진을 2장 이상 열면 여기서 한 장으로 합칠 수 있습니다.</p>
          : planError ? <p role="alert">{planError}</p>
          : plan && <div className="collage-frame" style={{ width: plan.width * scale, height: plan.height * scale }}>
            <canvas ref={canvas} aria-label="합친 사진 미리보기" style={{ width: plan.width * scale, height: plan.height * scale }} />
            {plan.cells.map((rect, index) => <button key={index} className="collage-cell" aria-label={`칸 ${index + 1}: ${nameOf(cells[index]?.photoId ?? null)}`}
              aria-pressed={selected === index} data-swap={swapFrom === index || undefined} disabled={saving}
              title="누르면 선택 · 끌어서 위치 · 휠로 확대"
              style={{ left: rect.x * scale, top: rect.y * scale, width: rect.width * scale, height: rect.height * scale, borderRadius: plan.radius * scale }}
              onPointerDown={event => pointerDown(index, event)} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}
              onWheel={event => { if (!busy && cells[index]?.photoId) { setSelected(index); setZoom(index, cells[index].view.zoom * Math.exp(-event.deltaY * 0.0015)) } }}
              onKeyDown={event => cellKey(index, event)} />)}
          </div>}
        </div>
        <div className="view-tools">
          <span className="hint" data-testid="collage-hint">{swapFrom !== null ? `바꿀 칸을 누르세요 (${swapFrom + 1}번 칸과 바꿉니다) · Esc 취소`
            : selected !== null ? `${selected + 1}번 칸 · ${current?.photoId ? nameOf(current.photoId) : '빈 칸'} — 아래 사진을 누르면 바뀝니다`
            : '칸을 누르고 아래 사진을 누르면 바뀝니다 · 끌어서 위치, 휠로 확대'}</span>
          <span className="maker-size" data-testid="collage-size">{sizeLabel} · {options.format === 'jpg' ? 'JPG' : 'PNG'}</span>
        </div>
      </div>
      <aside className="collage-side">
        <section className="collage-panel" aria-label="합치기 설정">
          <div className="pane-heading"><h2>레이아웃 <small>{layout.name}</small></h2></div>
          <div className="collage-layouts" role="radiogroup" aria-label="레이아웃">
            {COLLAGE_LAYOUTS.map(item => <button key={item.id} role="radio" aria-checked={options.layout === item.id} aria-label={item.name} title={item.id === 'stack' ? `${item.name} (2~${STACK_MAX}장, 사진마다 비율 유지)` : item.name}
              disabled={busy} onClick={() => change({ layout: item.id })}><LayoutIcon layout={item.id} /></button>)}
          </div>
          <label className="collage-range">간격
            <input type="range" aria-label="간격 슬라이더" min="0" max={MAX_GAP} step="1" disabled={busy} value={options.gap} onChange={e => change({ gap: e.target.valueAsNumber })} />
            <input type="number" aria-label="간격" min="0" max={MAX_GAP} step="1" disabled={busy} value={options.gap}
              onChange={e => { const value = e.target.valueAsNumber; if (Number.isInteger(value) && value >= 0 && value <= MAX_GAP) change({ gap: value }) }} />
          </label>
          <label className="collage-range">모서리
            <input type="range" aria-label="모서리 둥글게 슬라이더" min="0" max={MAX_RADIUS} step="1" disabled={busy} value={options.radius} onChange={e => change({ radius: e.target.valueAsNumber })} />
            <input type="number" aria-label="모서리 둥글게" min="0" max={MAX_RADIUS} step="1" disabled={busy} value={options.radius}
              onChange={e => { const value = e.target.valueAsNumber; if (Number.isInteger(value) && value >= 0 && value <= MAX_RADIUS) change({ radius: value }) }} />
          </label>
          <label className="check"><input type="checkbox" checked={options.margin} disabled={busy} onChange={e => change({ margin: e.target.checked })} />바깥 여백 (간격과 같은 크기)</label>
          <div className="collage-colors" role="radiogroup" aria-label="배경색">
            {COLLAGE_BACKGROUNDS.map(item => <button key={item.color} role="radio" className="swatch" aria-checked={options.background === item.color} aria-label={`배경색: ${item.name}`} title={item.name}
              disabled={busy} style={{ background: item.color }} onClick={() => change({ background: item.color })} />)}
            <ColorField label="배경색 직접 고르기" value={options.background} disabled={busy} onLive={background => change({ background })} onCommit={() => undefined} />
          </div>
          <div className="collage-output">
            <label>너비<select aria-label="출력 너비" value={options.width} disabled={busy} onChange={e => change({ width: Number(e.target.value) as CollageOptions['width'] })}>
              {COLLAGE_WIDTHS.map(width => <option key={width} value={width}>{width}px</option>)}
            </select></label>
            <div className="segmented" role="radiogroup" aria-label="합친 사진 형식">
              {(['jpg', 'png'] as const).map(format => <button key={format} role="radio" aria-checked={options.format === format} disabled={busy} onClick={() => change({ format })}>{format.toUpperCase()}</button>)}
            </div>
          </div>
          <div className="collage-selected" role="group" aria-label="고른 칸">
            <label className="collage-range" title={selected === null ? '미리보기에서 칸을 누르세요' : `${selected + 1}번 칸 확대`}>확대
              <input type="range" aria-label="칸 확대" min="100" max={MAX_ZOOM * 100} step="1" disabled={busy || !current?.photoId} value={Math.round((current?.view.zoom ?? 1) * 100)}
                onChange={e => { if (selected !== null) setZoom(selected, e.target.valueAsNumber / 100) }} />
              <span className="collage-zoom">{Math.round((current?.view.zoom ?? 1) * 100)}%</span>
            </label>
            <div className="collage-actions">
              <button aria-pressed={swapFrom !== null} disabled={busy || selected === null || cells.length < 2} title="누른 뒤 바꿀 다른 칸을 누르세요"
                onClick={() => setSwapFrom(swapFrom === null ? selected : null)}>⇄ 다른 칸과 바꾸기</button>
              <button disabled={busy || selected === null || (!current?.photoId && (layout.rows !== null || cells.length <= 2))}
                title={layout.rows ? '칸을 비웁니다' : '이 사진을 뺍니다'} onClick={() => { if (selected === null) return; setCells(removeCell(cells, options.layout, selected)); setSelected(null); setSwapFrom(null) }}>빼기</button>
            </div>
          </div>
        </section>
        <div className="maker-footer">
          <div className="gif-output"><span>출력 폴더</span><span className="folder-name" title={outputFolder ?? undefined}>{outputFolder ?? '미지정 · 저장 시 선택'}</span></div>
          <button className="primary maker-save" disabled={!canSave} onClick={() => void save()} title="출력 폴더에 <첫 사진 이름>_collage로 저장 (Ctrl+S)">{saving ? '저장 중…' : loading ? '사진 준비 중…' : '합친 사진 저장'}</button>
        </div>
      </aside>
    </div>
    {/* Only while shown: the editor's own strip uses the same classes and names. */}
    {active && !!photos.length && <section className="photo-list" aria-label="합칠 사진">
      <div className="photo-nav"><h2>{cells.filter(cell => cell.photoId).length} / {cells.length}칸</h2></div>
      <div className="photo-strip">
        {photos.map((item, index) => {
          const used = cells.map((cell, at) => cell.photoId === item.id ? at + 1 : 0).filter(Boolean)
          const turn = turnOf(item.id)
          return <div key={item.id} className="photo-cell">
            <button className="photo-item" disabled={busy} aria-label={`사진 ${index + 1}: ${item.name}`} aria-pressed={used.length > 0} title={selected !== null ? `${selected + 1}번 칸에 넣기` : '빈 칸에 넣기'} onClick={() => choosePhoto(item.id)}>
              <img src={item.thumbnail} alt="" width="80" height="60" loading="lazy" data-turn={turn} style={turn ? { transform: `rotate(${turn * 90}deg)` } : undefined} />
              <span>{index + 1}. {item.name}</span>
              <small>{used.length ? `${used.join('·')}번 칸` : '안 씀'}</small>
            </button>
          </div>
        })}
      </div>
    </section>}
  </div>
}
