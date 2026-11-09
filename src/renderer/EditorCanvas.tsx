import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Stage, Layer, Image as CanvasImage, Transformer, Group, Ellipse } from 'react-konva'
import type Konva from 'konva'
import type { BlurRegion, Placement } from '../shared/model'
import { buildRegionPatch, ellipsePath, regionKey, type RegionPatch } from './regions'
import { renderAdjusted, releaseCanvas } from './filters'
import { isNeutral } from '../shared/filters'
import type { Scene } from '../shared/scene'
import { fitScale } from '../shared/model'
// A bundled vector cursor keeps the rotation affordance crisp at high DPI.
const rotationCursor = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><g fill="none" stroke="white" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M24 11a10 10 0 1 0 1 9M24 4v8h-8"/></g><g fill="none" stroke="#262b36" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M24 11a10 10 0 1 0 1 9M24 4v8h-8"/></g></svg>')}") 16 16, crosshair`
interface Props {
  photo: { width: number; height: number; bitmap: ImageBitmap }
  assets: ReadonlyMap<string, { bitmap: ImageBitmap }>
  scene: Scene
  disabled: boolean
  onSelect(id: string | null): void
  onChange(id: string, value: Placement): void
  info?: ReactNode
  /** When true, dragging on the photo draws a new blur region instead of selecting. */
  drawMode?: boolean
  onDraw?(value: Placement): void
}
type Draft = { start: { x: number; y: number }; end: { x: number; y: number }; circle: boolean }
function draftPlacement(draft: Draft, photo: { width: number; height: number }): Placement {
  let width = Math.abs(draft.end.x - draft.start.x), height = Math.abs(draft.end.y - draft.start.y)
  if (width < 6 && height < 6) {
    // A plain click drops a default circle centered on the pointer.
    const diameter = Math.max(8, Math.round(Math.min(photo.width, photo.height) / 5))
    return { x: draft.start.x, y: draft.start.y, width: diameter, height: diameter, rotation: 0 }
  }
  if (draft.circle) width = height = Math.max(width, height)
  const x = draft.start.x + Math.sign(draft.end.x - draft.start.x || 1) * width / 2
  const y = draft.start.y + Math.sign(draft.end.y - draft.start.y || 1) * height / 2
  return { x, y, width: Math.max(4, width), height: Math.max(4, height), rotation: 0 }
}
export function EditorCanvas({ photo, assets, scene, disabled, onSelect, onChange, info, drawMode = false, onDraw }: Props) {
  const area = useRef<HTMLDivElement>(null)
  const images = useRef(new Map<string, Konva.Node>())
  const [draft, setDraft] = useState<Draft | null>(null)
  const [moving, setMoving] = useState<string | null>(null)
  // Adjusted photo: a reduced copy right away for live slider feedback, full resolution once input settles.
  const [adjusted, setAdjusted] = useState<{ canvas: HTMLCanvasElement; full: boolean } | null>(null)
  const adjustKey = JSON.stringify(scene.adjust)
  useEffect(() => {
    const adjust = JSON.parse(adjustKey) as Scene['adjust']
    if (isNeutral(adjust)) { setAdjusted(null); return }
    const quick = renderAdjusted(photo.bitmap, adjust, 1200)!
    setAdjusted({ canvas: quick, full: quick.width === photo.width })
    if (quick.width === photo.width) return
    const timer = window.setTimeout(() => setAdjusted({ canvas: renderAdjusted(photo.bitmap, adjust)!, full: true }), 220)
    return () => window.clearTimeout(timer)
  }, [adjustKey, photo.bitmap, photo.width])
  const shown = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => { if (shown.current && shown.current !== adjusted?.canvas) releaseCanvas(shown.current); shown.current = adjusted?.canvas ?? null }, [adjusted])
  useEffect(() => () => releaseCanvas(shown.current), [])
  const patchSource = adjusted?.full ? adjusted.canvas : isNeutral(scene.adjust) ? photo.bitmap : null
  const patchCache = useRef({ source: null as unknown, entries: new Map<string, { key: string; patch: RegionPatch | null }>() })
  const patches = useMemo(() => {
    const cache = patchCache.current.source === patchSource ? patchCache.current.entries : new Map<string, { key: string; patch: RegionPatch | null }>()
    // While the full-resolution adjusted photo is pending, keep the previous patches so hidden areas never flash.
    if (!patchSource) return patchCache.current.entries
    const next = new Map<string, { key: string; patch: RegionPatch | null }>()
    for (const region of scene.regions) {
      const key = regionKey(region), cached = cache.get(region.id)
      next.set(region.id, cached && cached.key === key ? cached : { key, patch: buildRegionPatch(patchSource, region) })
    }
    for (const [id, entry] of patchCache.current.entries) if (next.get(id) !== entry && entry.patch) releaseCanvas(entry.patch.canvas)
    patchCache.current = { source: patchSource, entries: next }
    return next
  }, [scene.regions, patchSource])
  useEffect(() => () => { for (const entry of patchCache.current.entries.values()) releaseCanvas(entry.patch?.canvas) }, [])
  const selectedRegion = scene.regions.some(item => item.id === scene.selectedId)
  const stage = useRef<Konva.Stage>(null)
  const [zoom, setZoom] = useState<number | null>(null)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [panMode, setPanMode] = useState(false)
  const transformer = useRef<Konva.Transformer>(null)
  const [size, setSize] = useState({ width: 600, height: 480 })
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setSize({ width: Math.max(1, entry.contentRect.width - 48), height: Math.max(1, entry.contentRect.height - 48) }))
    observer.observe(area.current!)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const image = scene.selectedId ? images.current.get(scene.selectedId) : undefined
    transformer.current?.nodes(image && !panMode && !drawMode ? [image] : [])
  }, [scene.selectedId, scene.stickers, scene.regions, panMode, drawMode])
  useEffect(() => {
    if (!draft) return
    const finish = (event: MouseEvent) => { setDraft(null); onDraw?.(draftPlacement({ ...draft, circle: draft.circle || event.shiftKey }, photo)) }
    window.addEventListener('mouseup', finish)
    return () => window.removeEventListener('mouseup', finish)
  }, [draft, onDraw, photo])
  useEffect(() => { if (!drawMode) setDraft(null) }, [drawMode])
  const pointer = () => {
    const point = stage.current?.getRelativePointerPosition()
    return point ? { x: Math.min(photo.width, Math.max(0, point.x)), y: Math.min(photo.height, Math.max(0, point.y)) } : null
  }
  const scale = zoom ?? fitScale(photo.width, photo.height, size.width, size.height)
  const viewport = { width: Math.min(photo.width * scale, size.width), height: Math.min(photo.height * scale, size.height) }
  const constrain = (point: { x: number; y: number }, nextScale = scale) => ({
    x: Math.max(Math.min(0, Math.min(photo.width * nextScale, size.width) - photo.width * nextScale), Math.min(0, point.x)),
    y: Math.max(Math.min(0, Math.min(photo.height * nextScale, size.height) - photo.height * nextScale), Math.min(0, point.y))
  })
  const position = constrain(pan)
  function changeZoom(next: number, pointer?: { x: number; y: number }) {
    const nextScale = Math.max(0.01, Math.min(4, next))
    const origin = pointer ?? { x: viewport.width / 2, y: viewport.height / 2 }
    const target = pointer ?? { x: Math.min(photo.width * nextScale, size.width) / 2, y: Math.min(photo.height * nextScale, size.height) / 2 }
    setPan(constrain({ x: target.x - (origin.x - position.x) / scale * nextScale, y: target.y - (origin.y - position.y) / scale * nextScale }, nextScale))
    setZoom(nextScale)
  }
  const deselect = (event: Konva.KonvaEventObject<Event>) => {
    if (!disabled && !panMode && !drawMode && event.target === event.target.getStage()) onSelect(null)
  }
  const interactive = !disabled && !panMode && !drawMode
  const transformEnd = (id: string) => {
    const node = images.current.get(id)!
    const next = { x: node.x(), y: node.y(), width: node.width() * node.scaleX(), height: node.height() * node.scaleY(), rotation: node.rotation() }
    node.scale({ x: 1, y: 1 })
    setMoving(null)
    onChange(id, next)
  }
  const regionNode = (region: BlurRegion) => <Ellipse key={region.id} name="blur-region"
    ref={node => { if (node) images.current.set(region.id, node); else images.current.delete(region.id) }}
    x={region.x} y={region.y} radiusX={region.width / 2} radiusY={region.height / 2} rotation={region.rotation}
    fill={moving === region.id ? 'rgba(91,69,201,0.25)' : 'transparent'} stroke="#ffffff" strokeWidth={1.5} dash={[6, 4]} strokeScaleEnabled={false}
    shadowColor="#000" shadowBlur={2} shadowOpacity={0.6} shadowForStrokeEnabled
    draggable={interactive} listening={interactive}
    onMouseDown={() => onSelect(region.id)} onTouchStart={() => onSelect(region.id)}
    onDragStart={() => { onSelect(region.id); setMoving(region.id) }} onTransformStart={() => setMoving(region.id)}
    onDragEnd={event => { setMoving(null); onChange(region.id, { ...region, x: event.target.x(), y: event.target.y() }) }}
    onTransformEnd={() => transformEnd(region.id)} />
  return <section className="canvas-editor">
    <div ref={area} className="canvas-area" data-testid="canvas-area" tabIndex={0} aria-label="사진 편집 캔버스"
    onMouseDownCapture={() => area.current?.focus({ preventScroll: true })}>
    <div className="canvas-frame" data-testid="canvas-frame" data-scale={scale} data-pan-x={position.x} data-pan-y={position.y} style={{ cursor: panMode ? 'grab' : drawMode ? 'crosshair' : undefined }}>
      <Stage ref={stage} width={viewport.width} height={viewport.height} x={position.x} y={position.y} scaleX={scale} scaleY={scale}
        draggable={panMode && !disabled} dragBoundFunc={point => constrain(point)}
        onDragEnd={event => { if (event.target === stage.current) setPan(constrain(event.target.position())) }}
        onWheel={event => {
          if (disabled || (!event.evt.ctrlKey && !event.evt.metaKey)) return
          event.evt.preventDefault()
          changeZoom(scale * (event.evt.deltaY < 0 ? 1.1 : 1 / 1.1), stage.current?.getPointerPosition() ?? undefined)
        }} onMouseDown={event => {
          if (drawMode && !disabled && event.evt.button === 0) { const point = pointer(); if (point) setDraft({ start: point, end: point, circle: event.evt.shiftKey }); return }
          deselect(event)
        }} onMouseMove={event => { if (draft) { const point = pointer(); if (point) setDraft({ ...draft, end: point, circle: event.evt.shiftKey }) } }}
        onTouchStart={deselect}>
        <Layer ref={layer => { layer?.getNativeCanvasElement().setAttribute('data-testid', 'photo-content') }}>
          <Group clipX={0} clipY={0} clipWidth={photo.width} clipHeight={photo.height}>
            <CanvasImage image={adjusted?.canvas ?? photo.bitmap} width={photo.width} height={photo.height} listening={false} />
            {scene.regions.map(region => {
              const patch = patches.get(region.id)?.patch
              return patch && moving !== region.id ? <Group key={region.id} listening={false} clipFunc={context => ellipsePath(context, region)}>
                <CanvasImage image={patch.canvas} x={patch.bounds.x} y={patch.bounds.y} />
              </Group> : null
            })}
            {scene.regions.map(regionNode)}
            {scene.stickers.map(placement => <CanvasImage key={placement.id}
              ref={node => { if (node) images.current.set(placement.id, node); else images.current.delete(placement.id) }}
              image={assets.get(placement.assetId)?.bitmap}
              x={placement.x} y={placement.y} width={placement.width} height={placement.height}
              offsetX={placement.width / 2} offsetY={placement.height / 2} rotation={placement.rotation}
              draggable={interactive} listening={interactive}
              onMouseDown={() => onSelect(placement.id)} onTouchStart={() => onSelect(placement.id)}
              onDragStart={() => onSelect(placement.id)}
              onDragEnd={event => onChange(placement.id, { ...placement, x: event.target.x(), y: event.target.y() })}
              onTransformEnd={() => transformEnd(placement.id)} />)}
            {draft && (() => { const value = draftPlacement(draft, photo); return <Ellipse x={value.x} y={value.y} radiusX={value.width / 2} radiusY={value.height / 2}
              fill="rgba(91,69,201,0.2)" stroke="#ffffff" strokeWidth={1.5} dash={[6, 4]} strokeScaleEnabled={false} listening={false} /> })()}
          </Group>
        </Layer>
        <Layer ref={layer => { layer?.getNativeCanvasElement().setAttribute('data-testid', 'editor-overlay') }}>
          <Transformer ref={transformer} enabledAnchors={selectedRegion ? ['top-left', 'top-center', 'top-right', 'middle-left', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right'] : ['top-left', 'top-right', 'bottom-left', 'bottom-right']}
            rotateAnchorCursor={rotationCursor}
            keepRatio={!selectedRegion} flipEnabled={false} rotateEnabled={!disabled} resizeEnabled={!disabled}
            boundBoxFunc={(oldBox, newBox) => Math.abs(newBox.width) < 4 || Math.abs(newBox.height) < 4 || Math.abs(newBox.width) > 32768 * scale || Math.abs(newBox.height) > 32768 * scale ? oldBox : newBox} />
        </Layer>
      </Stage>
    </div>
  </div>
    <div className="view-tools" aria-label="보기 조작">
      <button disabled={disabled} onClick={() => { setZoom(null); setPan({ x: 0, y: 0 }); setPanMode(false) }}>화면 맞춤</button>
      <button disabled={disabled} onClick={() => changeZoom(scale / 1.25)} aria-label="축소">−</button>
      <span className="zoom" data-testid="zoom-level" title="Ctrl/Cmd+휠로 확대·축소">{Math.round(scale * 100)}%</span>
      <button disabled={disabled} onClick={() => changeZoom(scale * 1.25)} aria-label="확대">+</button>
      <button disabled={disabled} onClick={() => changeZoom(1)}>100%</button>
      <button disabled={disabled} aria-pressed={panMode} onClick={() => setPanMode(!panMode)}>화면 이동</button>
      <span className="canvas-info">{info}</span>
    </div>
  </section>
}
