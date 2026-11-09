import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Stage, Layer, Image as CanvasImage, Transformer, Group } from 'react-konva'
import type Konva from 'konva'
import type { Placement } from '../shared/model'
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
}
export function EditorCanvas({ photo, assets, scene, disabled, onSelect, onChange, info }: Props) {
  const area = useRef<HTMLDivElement>(null)
  const images = useRef(new Map<string, Konva.Image>())
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
    transformer.current?.nodes(image && !panMode ? [image] : [])
  }, [scene.selectedId, scene.stickers, panMode])
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
    if (!disabled && !panMode && event.target === event.target.getStage()) onSelect(null)
  }
  return <section className="canvas-editor">
    <div ref={area} className="canvas-area" data-testid="canvas-area" tabIndex={0} aria-label="사진 편집 캔버스"
    onMouseDownCapture={() => area.current?.focus({ preventScroll: true })}>
    <div className="canvas-frame" data-testid="canvas-frame" data-scale={scale} data-pan-x={position.x} data-pan-y={position.y} style={{ cursor: panMode ? 'grab' : undefined }}>
      <Stage ref={stage} width={viewport.width} height={viewport.height} x={position.x} y={position.y} scaleX={scale} scaleY={scale}
        draggable={panMode && !disabled} dragBoundFunc={point => constrain(point)}
        onDragEnd={event => { if (event.target === stage.current) setPan(constrain(event.target.position())) }}
        onWheel={event => {
          if (disabled || (!event.evt.ctrlKey && !event.evt.metaKey)) return
          event.evt.preventDefault()
          changeZoom(scale * (event.evt.deltaY < 0 ? 1.1 : 1 / 1.1), stage.current?.getPointerPosition() ?? undefined)
        }} onMouseDown={deselect} onTouchStart={deselect}>
        <Layer ref={layer => { layer?.getNativeCanvasElement().setAttribute('data-testid', 'photo-content') }}>
          <Group clipX={0} clipY={0} clipWidth={photo.width} clipHeight={photo.height}>
            <CanvasImage image={photo.bitmap} width={photo.width} height={photo.height} listening={false} />
            {scene.stickers.map(placement => <CanvasImage key={placement.id}
              ref={node => { if (node) images.current.set(placement.id, node); else images.current.delete(placement.id) }}
              image={assets.get(placement.assetId)?.bitmap}
              x={placement.x} y={placement.y} width={placement.width} height={placement.height}
              offsetX={placement.width / 2} offsetY={placement.height / 2} rotation={placement.rotation}
              draggable={!disabled && !panMode} listening={!disabled && !panMode}
              onMouseDown={() => onSelect(placement.id)} onTouchStart={() => onSelect(placement.id)}
              onDragStart={() => onSelect(placement.id)}
              onDragEnd={event => onChange(placement.id, { ...placement, x: event.target.x(), y: event.target.y() })}
              onTransformEnd={() => {
                const node = images.current.get(placement.id)!
                const next = { x: node.x(), y: node.y(), width: node.width() * node.scaleX(), height: node.height() * node.scaleY(), rotation: node.rotation() }
                node.scale({ x: 1, y: 1 })
                onChange(placement.id, next)
              }} />)}
          </Group>
        </Layer>
        <Layer ref={layer => { layer?.getNativeCanvasElement().setAttribute('data-testid', 'editor-overlay') }}>
          <Transformer ref={transformer} enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
            rotateAnchorCursor={rotationCursor}
            keepRatio flipEnabled={false} rotateEnabled={!disabled} resizeEnabled={!disabled}
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
