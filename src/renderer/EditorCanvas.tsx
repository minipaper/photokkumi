import { useEffect, useRef, useState } from 'react'
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
}
export function EditorCanvas({ photo, assets, scene, disabled, onSelect, onChange }: Props) {
  const area = useRef<HTMLDivElement>(null)
  const images = useRef(new Map<string, Konva.Image>())
  const transformer = useRef<Konva.Transformer>(null)
  const [size, setSize] = useState({ width: 600, height: 480 })
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width - 48, height: entry.contentRect.height - 48 }))
    observer.observe(area.current!)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const image = scene.selectedId ? images.current.get(scene.selectedId) : undefined
    transformer.current?.nodes(image ? [image] : [])
  }, [scene.selectedId, scene.stickers])
  const scale = fitScale(photo.width, photo.height, size.width, size.height)
  const deselect = (event: Konva.KonvaEventObject<Event>) => {
    if (!disabled && event.target === event.target.getStage()) onSelect(null)
  }
  return <div ref={area} className="canvas-area" data-testid="canvas-area" tabIndex={0} aria-label="사진 편집 캔버스"
    onMouseDownCapture={() => area.current?.focus({ preventScroll: true })}>
    <div className="canvas-frame" data-testid="canvas-frame" data-scale={scale}>
      <Stage width={photo.width * scale} height={photo.height * scale} scaleX={scale} scaleY={scale} onMouseDown={deselect} onTouchStart={deselect}>
        <Layer ref={layer => { layer?.getNativeCanvasElement().setAttribute('data-testid', 'photo-content') }}>
          <Group clipX={0} clipY={0} clipWidth={photo.width} clipHeight={photo.height}>
            <CanvasImage image={photo.bitmap} width={photo.width} height={photo.height} listening={false} />
            {scene.stickers.map(placement => <CanvasImage key={placement.id}
              ref={node => { if (node) images.current.set(placement.id, node); else images.current.delete(placement.id) }}
              image={assets.get(placement.assetId)?.bitmap}
              x={placement.x} y={placement.y} width={placement.width} height={placement.height}
              offsetX={placement.width / 2} offsetY={placement.height / 2} rotation={placement.rotation}
              draggable={!disabled} listening={!disabled}
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
}
