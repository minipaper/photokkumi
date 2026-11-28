import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { resizeCrop, roundCrop, moveCrop, type CropRect } from '../shared/crop'

interface Props {
  video: { width: number; height: number }
  /** Kept part in video pixels (rotation applied), or null to show the frame only. */
  crop: CropRect | null
  /** width / height, or null for free. */
  ratio: number | null
  disabled: boolean
  onChange(crop: CropRect): void
  children: ReactNode
}
const ANCHORS = ['top-left', 'top-center', 'top-right', 'middle-right', 'bottom-right', 'bottom-center', 'bottom-left', 'middle-left'] as const

/**
 * The preview frame sized to the video's aspect inside the free space, with an optional crop box on top.
 * Pointer math is in video pixels (screen delta / scale), so the result matches what ffmpeg crops.
 */
export function VideoCropBox({ video, crop, ratio, disabled, onChange, children }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0)
  useEffect(() => {
    const element = host.current!
    const measure = () => setScale(Math.min(element.clientWidth / video.width, element.clientHeight / video.height))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [video.width, video.height])

  const drag = (anchor: string | null) => (event: ReactPointerEvent<HTMLElement>) => {
    if (disabled || !crop || !scale || event.button !== 0) return
    event.preventDefault(); event.stopPropagation()
    const target = event.currentTarget, start = { x: event.clientX, y: event.clientY }, from = crop
    target.setPointerCapture(event.pointerId)
    const onMove = (next: PointerEvent) => {
      const dx = (next.clientX - start.x) / scale, dy = (next.clientY - start.y) / scale
      if (!anchor) { onChange(moveCrop(from, Math.round(from.x + dx), Math.round(from.y + dy), video)); return }
      const left = anchor.endsWith('left'), right = anchor.endsWith('right'), top = anchor.startsWith('top'), bottom = anchor.startsWith('bottom')
      const asked = {
        x: from.x + (left ? dx : 0), y: from.y + (top ? dy : 0),
        width: from.width + (left ? -dx : right ? dx : 0), height: from.height + (top ? -dy : bottom ? dy : 0)
      }
      onChange(roundCrop(resizeCrop(from, asked, anchor, ratio, video), ratio, video))
    }
    const onUp = () => { target.removeEventListener('pointermove', onMove); target.removeEventListener('pointerup', onUp); target.removeEventListener('pointercancel', onUp) }
    target.addEventListener('pointermove', onMove); target.addEventListener('pointerup', onUp); target.addEventListener('pointercancel', onUp)
  }
  const percent = (value: number, total: number) => `${value / total * 100}%`
  return <div className="gif-stage" ref={host}>
    <div className="gif-frame-box" style={{ width: video.width * scale, height: video.height * scale }}>
      {children}
      {crop && <div className="video-crop" data-testid="video-crop" aria-label="자를 영역" data-crop={`${crop.x},${crop.y},${crop.width},${crop.height}`}
        style={{ left: percent(crop.x, video.width), top: percent(crop.y, video.height), width: percent(crop.width, video.width), height: percent(crop.height, video.height) }}
        onPointerDown={drag(null)}>
        {ANCHORS.filter(anchor => !ratio || !anchor.includes('center') && !anchor.startsWith('middle')).map(anchor =>
          <span key={anchor} className={`video-crop-handle ${anchor}`} data-anchor={anchor} onPointerDown={drag(anchor)} />)}
      </div>}
    </div>
  </div>
}
