import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Stage, Layer, Image as CanvasImage, Transformer, Group, Ellipse, Rect, Shape } from 'react-konva'
import type Konva from 'konva'
import type { BlurRegion, Placement, RegionShape } from '../shared/model'
import { buildRegionPatch, regionPath, regionKey, type RegionPatch } from './regions'
import { renderAdjusted, releaseCanvas } from './filters'
import { isNeutral } from '../shared/filters'
import type { Scene } from '../shared/scene'
import { fitScale } from '../shared/model'
import type { TextItem } from '../shared/text'
import { drawText } from './text'
import { drawShape as paintShape } from './thumb'
import type { ShapeItem } from '../shared/shapes'
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
  /** Region tool: dragging on empty photo (or the margin around it) draws a region, clicking a region selects it; stickers are locked. */
  drawMode?: boolean
  drawShape?: RegionShape
  onDraw?(value: Placement): void
  /** Buttons shown in a small bar floating above the selected item. */
  selectionTools?: ReactNode
}
type Point = { x: number; y: number }
type Draft = { start: Point; end: Point; circle: boolean; client: Point; moved: boolean }
/** Points are already clamped to the photo, so a drag that starts or ends outside snaps to the photo edge. */
function draftPlacement(draft: Draft): Placement {
  let width = Math.abs(draft.end.x - draft.start.x), height = Math.abs(draft.end.y - draft.start.y)
  if (draft.circle) width = height = Math.max(width, height)
  const x = draft.start.x + Math.sign(draft.end.x - draft.start.x || 1) * width / 2
  const y = draft.start.y + Math.sign(draft.end.y - draft.start.y || 1) * height / 2
  return { x, y, width: Math.max(4, width), height: Math.max(4, height), rotation: 0 }
}
export function EditorCanvas({ photo, assets, scene, disabled, onSelect, onChange, info, drawMode = false, drawShape = 'ellipse', onDraw, selectionTools }: Props) {
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
  // Each tool edits its own layer: stickers normally, regions while the region tool is on.
  const selectedRegion = scene.regions.some(item => item.id === scene.selectedId)
  const selectedShape = scene.shapes.some(item => item.id === scene.selectedId)
  const selectedOnLayer = !!scene.selectedId && (drawMode ? selectedRegion : [...scene.stickers, ...scene.shapes, ...scene.texts].some(item => item.id === scene.selectedId))
  useEffect(() => {
    const image = scene.selectedId ? images.current.get(scene.selectedId) : undefined
    transformer.current?.nodes(image && !panMode && selectedOnLayer ? [image] : [])
  }, [scene.selectedId, scene.stickers, scene.regions, scene.shapes, scene.texts, panMode, selectedOnLayer])
  // A font that finishes loading after the first paint (e.g. an installed font) redraws the texts.
  useEffect(() => {
    const redraw = () => stage.current?.batchDraw()
    document.fonts.addEventListener('loadingdone', redraw)
    return () => document.fonts.removeEventListener('loadingdone', redraw)
  }, [])
  /** Photo coordinates for a client point, clamped to the photo. Works outside the stage too. */
  const toPhoto = (clientX: number, clientY: number): Point | null => {
    const node = stage.current
    if (!node) return null
    const rect = node.container().getBoundingClientRect(), s = node.scaleX()
    return { x: Math.min(photo.width, Math.max(0, (clientX - rect.left - node.x()) / s)), y: Math.min(photo.height, Math.max(0, (clientY - rect.top - node.y()) / s)) }
  }
  const draftRef = useRef<Draft | null>(null)
  const startDraft = (event: MouseEvent) => {
    const point = toPhoto(event.clientX, event.clientY)
    if (!point) return
    const next = { start: point, end: point, circle: event.shiftKey, client: { x: event.clientX, y: event.clientY }, moved: false }
    draftRef.current = next; setDraft(next)
  }
  const drafting = !!draft
  useEffect(() => {
    if (!drafting) return
    const move = (event: MouseEvent) => {
      const current = draftRef.current, end = toPhoto(event.clientX, event.clientY)
      if (!current || !end) return
      const moved = current.moved || Math.hypot(event.clientX - current.client.x, event.clientY - current.client.y) > 4
      const next = { ...current, end, circle: event.shiftKey, moved }
      draftRef.current = next; setDraft(next)
    }
    const finish = (event: MouseEvent) => {
      const current = draftRef.current
      draftRef.current = null; setDraft(null)
      if (!current) return
      // A click without dragging just clears the selection; only a real drag creates a region.
      if (!current.moved) { onSelect(null); return }
      const value = draftPlacement({ ...current, circle: current.circle || event.shiftKey })
      if (value.width >= 4 && value.height >= 4) onDraw?.(value)
    }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', finish)
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', finish) }
    // toPhoto reads the live stage node, so the listeners only need re-binding when a draft starts or ends.
  }, [drafting, onDraw, onSelect])
  useEffect(() => { if (!drawMode) { draftRef.current = null; setDraft(null) } }, [drawMode])
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
  // Floating bar: screen box of the selected item's rotated bounds, placed above it (or below near the top edge).
  const selected = [...scene.stickers, ...scene.shapes, ...scene.texts, ...scene.regions].find(item => item.id === scene.selectedId)
  let toolbarAt: { left: number; top: number } | null = null
  if (selected && selectedOnLayer && selectionTools && !moving && !draft && !panMode && !disabled) {
    const angle = selected.rotation * Math.PI / 180, cos = Math.abs(Math.cos(angle)), sin = Math.abs(Math.sin(angle))
    const halfH = (selected.width * sin + selected.height * cos) / 2
    const cx = selected.x * scale + position.x, top = (selected.y - halfH) * scale + position.y, bottom = (selected.y + halfH) * scale + position.y
    // Below the box by default: the rotation handle owns the ~50px above it. Above (clear of that handle) only when there is no room below.
    const below = bottom + 14, above = top - 100
    const y = below + 36 <= viewport.height ? below : above >= 4 ? above : Math.max(4, viewport.height - 40)
    toolbarAt = { left: Math.max(90, Math.min(viewport.width - 90, cx)), top: y }
  }
  const deselect = (event: Konva.KonvaEventObject<Event>) => {
    if (!disabled && !panMode && !drawMode && event.target === event.target.getStage()) onSelect(null)
  }
  const interactive = !disabled && !panMode && !drawMode
  const regionsInteractive = !disabled && !panMode && drawMode
  const hoverCursor = (cursor: string) => (event: Konva.KonvaEventObject<MouseEvent>) => { const container = event.target.getStage()?.container(); if (container) container.style.cursor = cursor }
  const transformEnd = (id: string) => {
    const node = images.current.get(id)!
    const next = { x: node.x(), y: node.y(), width: node.width() * node.scaleX(), height: node.height() * node.scaleY(), rotation: node.rotation() }
    node.scale({ x: 1, y: 1 })
    setMoving(null)
    onChange(id, next)
  }
  const regionNode = (region: BlurRegion) => {
    const common = {
      ref: (node: Konva.Shape | null) => { if (node) images.current.set(region.id, node); else images.current.delete(region.id) },
      name: 'blur-region', x: region.x, y: region.y, rotation: region.rotation,
      fill: moving === region.id ? 'rgba(91,69,201,0.25)' : 'transparent', stroke: '#ffffff', strokeWidth: 1.5, dash: [6, 4], strokeScaleEnabled: false,
      shadowColor: '#000', shadowBlur: 2, shadowOpacity: 0.6, shadowForStrokeEnabled: true,
      draggable: regionsInteractive, listening: regionsInteractive,
      onMouseEnter: hoverCursor('move'), onMouseLeave: hoverCursor(''),
      onMouseDown: () => onSelect(region.id), onTouchStart: () => onSelect(region.id),
      onDragStart: () => { onSelect(region.id); setMoving(region.id) }, onTransformStart: () => setMoving(region.id),
      onDragEnd: (event: Konva.KonvaEventObject<DragEvent>) => { setMoving(null); onChange(region.id, { ...region, x: event.target.x(), y: event.target.y() }) },
      onTransformEnd: () => transformEnd(region.id)
    }
    return region.shape === 'rect'
      ? <Rect key={region.id} {...common} width={region.width} height={region.height} offsetX={region.width / 2} offsetY={region.height / 2} />
      : <Ellipse key={region.id} {...common} radiusX={region.width / 2} radiusY={region.height / 2} />
  }
  const shapeNode = (item: ShapeItem) => <Shape key={item.id} name="shape-item"
    ref={node => { if (node) images.current.set(item.id, node); else images.current.delete(item.id) }}
    x={item.x} y={item.y} width={item.width} height={item.height} offsetX={item.width / 2} offsetY={item.height / 2} rotation={item.rotation}
    sceneFunc={(context, shape) => {
      const native = context._context
      native.save(); native.translate(shape.width() / 2, shape.height() / 2); paintShape(native, { ...item, width: shape.width(), height: shape.height() }); native.restore()
    }}
    hitFunc={(context, shape) => { context.beginPath(); context.rect(0, 0, shape.width(), shape.height()); context.closePath(); context.fillStrokeShape(shape) }}
    draggable={interactive} listening={interactive}
    onMouseEnter={hoverCursor('move')} onMouseLeave={hoverCursor('')}
    onMouseDown={() => onSelect(item.id)} onTouchStart={() => onSelect(item.id)}
    onDragStart={() => { onSelect(item.id); setMoving(item.id) }} onTransformStart={() => setMoving(item.id)}
    onDragEnd={event => { setMoving(null); onChange(item.id, { ...item, x: event.target.x(), y: event.target.y() }) }}
    onTransformEnd={() => transformEnd(item.id)} />
  const textNode = (item: TextItem) => <Shape key={item.id} name="text-item"
    ref={node => { if (node) images.current.set(item.id, node); else images.current.delete(item.id) }}
    x={item.x} y={item.y} width={item.width} height={item.height} offsetX={item.width / 2} offsetY={item.height / 2} rotation={item.rotation}
    sceneFunc={(context, shape) => {
      const native = context._context
      native.save(); native.translate(shape.width() / 2, shape.height() / 2); drawText(native, item); native.restore()
    }}
    hitFunc={(context, shape) => { context.beginPath(); context.rect(0, 0, shape.width(), shape.height()); context.closePath(); context.fillStrokeShape(shape) }}
    draggable={interactive} listening={interactive}
    onMouseEnter={hoverCursor('move')} onMouseLeave={hoverCursor('')}
    onMouseDown={() => onSelect(item.id)} onTouchStart={() => onSelect(item.id)}
    onDragStart={() => { onSelect(item.id); setMoving(item.id) }} onTransformStart={() => setMoving(item.id)}
    onDragEnd={event => { setMoving(null); onChange(item.id, { ...item, x: event.target.x(), y: event.target.y() }) }}
    onTransformEnd={() => transformEnd(item.id)} />
  return <section className="canvas-editor">
    <div ref={area} className="canvas-area" data-testid="canvas-area" tabIndex={0} aria-label="사진 편집 캔버스"
    style={{ cursor: drawMode && !disabled ? 'crosshair' : undefined }}
    onMouseDownCapture={() => area.current?.focus({ preventScroll: true })}
    onMouseDown={event => { if (drawMode && !disabled && event.button === 0 && event.target === area.current) startDraft(event.nativeEvent) }}>
    <div className="canvas-frame" data-testid="canvas-frame" data-scale={scale} data-pan-x={position.x} data-pan-y={position.y} style={{ cursor: panMode ? 'grab' : drawMode ? 'crosshair' : undefined }}>
      {toolbarAt && <div className="selection-bar" role="toolbar" aria-label="선택 항목 도구" style={{ left: toolbarAt.left, top: toolbarAt.top }}
        onMouseDown={event => event.stopPropagation()}>{selectionTools}</div>}
      <Stage ref={stage} width={viewport.width} height={viewport.height} x={position.x} y={position.y} scaleX={scale} scaleY={scale}
        draggable={panMode && !disabled} dragBoundFunc={point => constrain(point)}
        onDragEnd={event => { if (event.target === stage.current) setPan(constrain(event.target.position())) }}
        onWheel={event => {
          if (disabled || (!event.evt.ctrlKey && !event.evt.metaKey)) return
          event.evt.preventDefault()
          changeZoom(scale * (event.evt.deltaY < 0 ? 1.1 : 1 / 1.1), stage.current?.getPointerPosition() ?? undefined)
        }} onMouseDown={event => {
          if (drawMode && !disabled && !panMode && event.evt.button === 0) { if (event.target === stage.current) startDraft(event.evt); return }
          deselect(event)
        }}
        onTouchStart={deselect}>
        <Layer ref={layer => { layer?.getNativeCanvasElement().setAttribute('data-testid', 'photo-content') }}>
          <Group clipX={0} clipY={0} clipWidth={photo.width} clipHeight={photo.height}>
            <CanvasImage image={adjusted?.canvas ?? photo.bitmap} width={photo.width} height={photo.height} listening={false} />
            {scene.regions.map(region => {
              const patch = patches.get(region.id)?.patch
              return patch && moving !== region.id ? <Group key={region.id} listening={false} clipFunc={context => regionPath(context, region)}>
                <CanvasImage image={patch.canvas} x={patch.bounds.x} y={patch.bounds.y} />
              </Group> : null
            })}
            {scene.regions.map(regionNode)}
            {scene.shapes.map(shapeNode)}
            {scene.stickers.map(placement => <CanvasImage key={placement.id}
              ref={node => { if (node) images.current.set(placement.id, node); else images.current.delete(placement.id) }}
              image={assets.get(placement.assetId)?.bitmap}
              x={placement.x} y={placement.y} width={placement.width} height={placement.height}
              offsetX={placement.width / 2} offsetY={placement.height / 2} rotation={placement.rotation}
              draggable={interactive} listening={interactive}
              onMouseDown={() => onSelect(placement.id)} onTouchStart={() => onSelect(placement.id)}
              onDragStart={() => { onSelect(placement.id); setMoving(placement.id) }} onTransformStart={() => setMoving(placement.id)}
              onDragEnd={event => { setMoving(null); onChange(placement.id, { ...placement, x: event.target.x(), y: event.target.y() }) }}
              onTransformEnd={() => transformEnd(placement.id)} />)}
            {scene.texts.map(textNode)}
            {draft?.moved && (() => {
              const value = draftPlacement(draft), look = { fill: 'rgba(91,69,201,0.2)', stroke: '#ffffff', strokeWidth: 1.5, dash: [6, 4], strokeScaleEnabled: false, listening: false }
              return drawShape === 'rect' ? <Rect x={value.x - value.width / 2} y={value.y - value.height / 2} width={value.width} height={value.height} {...look} />
                : <Ellipse x={value.x} y={value.y} radiusX={value.width / 2} radiusY={value.height / 2} {...look} />
            })()}
          </Group>
        </Layer>
        <Layer ref={layer => { layer?.getNativeCanvasElement().setAttribute('data-testid', 'editor-overlay') }}>
          <Transformer ref={transformer} enabledAnchors={selectedRegion || selectedShape ? ['top-left', 'top-center', 'top-right', 'middle-left', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right'] : ['top-left', 'top-right', 'bottom-left', 'bottom-right']}
            rotateAnchorCursor={rotationCursor}
            keepRatio={!selectedRegion && !selectedShape} flipEnabled={false} rotateEnabled={!disabled} resizeEnabled={!disabled}
            boundBoxFunc={(oldBox, newBox) => Math.abs(newBox.width) < 4 || Math.abs(newBox.height) < 4 || Math.abs(newBox.width) > 32768 * scale || Math.abs(newBox.height) > 32768 * scale ? oldBox : newBox} />
        </Layer>
      </Stage>
    </div>
  </div>
    <div className="view-tools" aria-label="보기 조작">
      <button className="icon" disabled={disabled} aria-label="화면 맞춤" title="화면 맞춤" onClick={() => { setZoom(null); setPan({ x: 0, y: 0 }); setPanMode(false) }}><svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/></svg></button>
      <button disabled={disabled} onClick={() => changeZoom(scale / 1.25)} aria-label="축소">−</button>
      <span className="zoom" data-testid="zoom-level" title="Ctrl/Cmd+휠로 확대·축소">{Math.round(scale * 100)}%</span>
      <button disabled={disabled} onClick={() => changeZoom(scale * 1.25)} aria-label="확대">+</button>
      <button disabled={disabled} onClick={() => changeZoom(1)}>100%</button>
      <button className="icon" disabled={disabled} aria-label="화면 이동" title="화면 이동 — 켜면 드래그로 확대한 사진을 움직입니다" aria-pressed={panMode} onClick={() => setPanMode(!panMode)}><svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 1.5v13M1.5 8h13M8 1.5 6 3.5M8 1.5l2 2M8 14.5l-2-2M8 14.5l2-2M1.5 8l2-2M1.5 8l2 2M14.5 8l-2-2M14.5 8l-2 2"/></svg></button>
      <span className="canvas-info">{info}</span>
    </div>
  </section>
}
