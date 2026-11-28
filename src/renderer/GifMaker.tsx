import { useCallback, useEffect, useRef, useState, type ComponentProps, type KeyboardEvent, type PointerEvent } from 'react'
import { loadPref, savePref } from './remember'
import { DEFAULT_GIF, GIF_FPS, GIF_WIDTHS, MAX_GIF_SECONDS, gifFrameCount, validGifOptions, type GifReceipt, type ToolStatus, type VideoCrop, type VideoRef } from '../shared/gif'
import { DEFAULT_MP4, MAX_MP4_SECONDS, MP4_WIDTHS, mp4Width, validMp4Options } from '../shared/video'
import { CROP_LABELS, aspectRatio, centeredCrop, type CropRect } from '../shared/crop'
import type { VideoColor } from '../shared/hdr'
import { VideoCropBox } from './VideoCropBox'
import { EditorCanvas } from './EditorCanvas'
import { LibraryPanel } from './LibraryPanel'
import { addInstance, addRegion, clearRegions, commitScene, emptyHistory, redoScene, removeSelected, undoScene, updateSelected, updateSelectedRegion, type Scene, type SceneHistory } from '../shared/scene'
import { validPlacement, type Placement, type RegionShape, type RegionStyle } from '../shared/model'
import { MAX_VIDEO_REGIONS } from '../shared/video-overlay'
import { drawOverlayPreview, overlayRequest } from './video-overlay'

interface Loaded { id: string; name: string; duration: number; width: number; height: number; hasAudio: boolean; color: VideoColor; previewFps: number; urls: string[]; blobs: Blob[]; frame: { width: number; height: number } }
type Panel = 'save' | 'hide' | 'sticker'
interface RegionEffect { shape: RegionShape; style: RegionStyle; strength: number }
const DEFAULT_EFFECT: RegionEffect = { shape: 'ellipse', style: 'mosaic', strength: 50 }
const validEffect = (value: unknown): value is RegionEffect => !!value && typeof value === 'object' && ['ellipse', 'rect'].includes((value as RegionEffect).shape)
  && ['blur', 'mosaic'].includes((value as RegionEffect).style) && Number.isInteger((value as RegionEffect).strength) && (value as RegionEffect).strength >= 1 && (value as RegionEffect).strength <= 100
/** A sticker from the library, decoded once (src.tsx shares its cache with the photo editor). */
export interface VideoSticker { id: string; width: number; height: number; bitmap: ImageBitmap }
type Format = 'gif' | 'mp4'
/** 자르기 choices; 'none' keeps the whole frame. */
const VIDEO_ASPECTS = ['none', 'free', '16:9', '4:3', '1:1', '3:4', '9:16'] as const
type VideoAspect = typeof VIDEO_ASPECTS[number]
const LIMIT: Record<Format, number> = { gif: MAX_GIF_SECONDS, mp4: MAX_MP4_SECONDS }
/** ffmpeg's crop (even sizes) and `scale=W:-2` (height rounded to an even number). */
const even = (value: number) => Math.floor(value / 2) * 2
const formatSeconds = (value: number) => value >= 60 ? `${Math.floor(value / 60)}분 ${Math.round(value % 60)}초` : `${value}초`
interface Props {
  /** A video handed over from a drop in either mode; `nonce` lets the same file be reopened. */
  incoming: { ref: VideoRef; nonce: number } | null
  outputFolder: string | null
  onSaved(receipt: GifReceipt): void
  onStatus(text: string): void
  onError(text: string): void
  onBusyChange(busy: boolean): void
  /** False while the photo editor is shown; playback pauses. */
  active: boolean
  /** The photo editor's sticker library (pick mode); using a sticker places it on the video instead. */
  library: Omit<ComponentProps<typeof LibraryPanel>, 'mode' | 'onUse' | 'canUse' | 'onManage'>
  loadSticker(id: string): Promise<VideoSticker>
}
const MIN_SPAN = 0.1
const round = (value: number) => Math.round(value * 1000) / 1000
const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent)
const formatBytes = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`

export function GifMaker({ incoming, outputFolder, onSaved, onStatus, onError, onBusyChange, active, library, loadSticker }: Props) {
  const api = window.photokkumi
  const [tool, setTool] = useState<ToolStatus | null>(null)
  const [video, setVideo] = useState<Loaded | null>(null)
  const [pending, setPending] = useState<VideoRef | null>(null)
  const [work, setWork] = useState<'tool' | 'load' | 'create' | null>(null)
  const [range, setRange] = useState({ start: 0, end: 0 })
  const [playhead, setPlayhead] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [width, setWidth] = useState<number>(() => loadPref('pk.gifWidth', DEFAULT_GIF.width, (v): v is number => (GIF_WIDTHS as readonly unknown[]).includes(v)))
  const [fps, setFps] = useState<number>(() => loadPref('pk.gifFps', DEFAULT_GIF.fps, (v): v is number => (GIF_FPS as readonly unknown[]).includes(v)))
  const [format, setFormat] = useState<Format>(() => loadPref('pk.videoFormat', 'gif', (v): v is Format => v === 'gif' || v === 'mp4'))
  const [mp4Size, setMp4Size] = useState<number>(() => loadPref('pk.mp4Width', DEFAULT_MP4.width, (v): v is number => (MP4_WIDTHS as readonly unknown[]).includes(v)))
  const [audio, setAudio] = useState<boolean>(() => loadPref('pk.videoAudio', DEFAULT_MP4.audio, (v): v is boolean => typeof v === 'boolean'))
  const [aspect, setAspect] = useState<VideoAspect>('none')
  const [crop, setCrop] = useState<CropRect | null>(null)
  const [progress, setProgress] = useState(0)
  // 가리기·스티커: the same Scene model as a photo, in preview-frame pixels (see video-overlay.ts).
  const [panel, setPanel] = useState<Panel>('save')
  const [overlay, setOverlay] = useState<SceneHistory>(emptyHistory)
  const [effect, setEffect] = useState<RegionEffect>(() => loadPref('pk.videoRegion', DEFAULT_EFFECT, validEffect))
  const [frameBitmap, setFrameBitmap] = useState<ImageBitmap | null>(null)
  const assets = useRef(new Map<string, VideoSticker>())
  const liveBase = useRef<SceneHistory | null>(null)
  const previewCanvas = useRef<HTMLCanvasElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const busy = work !== null
  // Finding ffmpeg must not block drops or mode switches; only decoding and encoding do.
  useEffect(() => { onBusyChange(work === 'load' || work === 'create') }, [work, onBusyChange])
  useEffect(() => { if (!active) setPlaying(false) }, [active])

  const act = useCallback(async <T,>(kind: 'tool' | 'load' | 'create', action: () => Promise<T>): Promise<T | undefined> => {
    setWork(kind); onError('')
    try { return await action() }
    catch (error) { onError(error instanceof Error ? error.message : 'GIF 작업에 실패했습니다.'); return undefined }
    finally { setWork(null) }
  }, [onError])
  const unwrap = <T,>(result: { ok: true; value: T } | { ok: false; error: string }): T => { if (!result.ok) throw new Error(result.error); return result.value }

  useEffect(() => { void act('tool', async () => setTool(unwrap(await api.gifToolStatus()))) }, [act, api])
  useEffect(() => { if (incoming) setPending(incoming.ref) }, [incoming])
  useEffect(() => api.onGifProgress(setProgress), [api])
  useEffect(() => () => { setVideo(current => { current?.urls.forEach(url => URL.revokeObjectURL(url)); return null }) }, [])
  const scene = overlay.present
  const placed = scene.regions.length + scene.stickers.length
  // The current preview frame as a bitmap, only while items are edited or placed (blur patches are built from it).
  const frameIndex = video ? Math.min(video.urls.length - 1, Math.max(0, Math.floor(playhead * video.previewFps))) : 0
  const needFrame = !!video && (panel !== 'save' || placed > 0)
  useEffect(() => {
    if (!needFrame || !video) { setFrameBitmap(null); return }
    let cancelled = false
    void createImageBitmap(video.blobs[frameIndex]).then(bitmap => { if (cancelled) bitmap.close(); else setFrameBitmap(bitmap) }, () => undefined)
    return () => { cancelled = true }
  }, [needFrame, video, frameIndex])
  // Close the previous frame once React has moved on to the next one.
  useEffect(() => () => frameBitmap?.close(), [frameBitmap])
  useEffect(() => {
    const canvas = previewCanvas.current
    if (canvas && frameBitmap && panel === 'save') drawOverlayPreview(canvas, frameBitmap, scene, assets.current)
  }, [frameBitmap, scene, panel])

  const load = useCallback((ref: VideoRef) => act('load', async () => {
    setPlaying(false)
    onStatus(`${ref.name} · 미리보기를 만드는 중…`)
    const info = unwrap(await api.loadVideo(ref.id))
    const blobs = info.frames.map(bytes => new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }))
    const first = await createImageBitmap(blobs[0]), frame = { width: first.width, height: first.height }
    first.close()
    const urls = blobs.map(blob => URL.createObjectURL(blob))
    setVideo(previous => { previous?.urls.forEach(url => URL.revokeObjectURL(url)); return { ...info, frames: [], urls, blobs, frame } })
    setOverlay(emptyHistory()); setPanel('save')
    // A GIF is usually a short moment; an MP4 is usually the whole clip minus the edges.
    const end = round(Math.min(info.duration, format === 'gif' ? 3 : MAX_MP4_SECONDS))
    setRange({ start: 0, end }); setPlayhead(0)
    setAspect('none'); setCrop(null)
    onStatus(`${info.name} · ${info.duration.toFixed(1)}초 · 사용할 구간을 [ ] 로 고른 뒤 저장하세요.`)
    root.current?.focus({ preventScroll: true })
  }), [act, api, onStatus, format])
  useEffect(() => {
    if (!pending || !tool?.found || busy) return
    setPending(null); void load(pending)
  }, [pending, tool, busy, load])

  // Loop playback inside the selected range.
  useEffect(() => {
    if (!playing || !video) return
    let frame = 0, last = performance.now()
    const step = (now: number) => {
      const delta = (now - last) / 1000; last = now
      setPlayhead(current => { const next = current + delta; return next >= range.end || next < range.start ? range.start : next })
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [playing, video, range])

  if (!tool) return <div className="gif-center"><p className="hint">ffmpeg를 찾는 중…</p></div>
  if (!tool.found) return <div className="gif-center"><section className="gif-setup" aria-label="ffmpeg 설치 안내">
    <h2>동영상 편집에는 ffmpeg가 필요합니다</h2>
    <p>포토꾸미는 ffmpeg를 포함하지 않습니다. 무료 프로그램인 ffmpeg를 한 번만 설치하면 휴대폰·카메라로 찍은 MOV, MP4 동영상을 잘라 GIF나 MP4로 저장할 수 있습니다.</p>
    <ol>
      <li>{isMac ? '터미널을 엽니다.' : '시작 메뉴에서 “터미널” 또는 “명령 프롬프트”를 엽니다.'}</li>
      <li>아래 명령을 복사해 붙여 넣고 Enter를 누릅니다.
        <input className="command" readOnly aria-label="설치 명령" value={isMac ? 'brew install ffmpeg' : 'winget install Gyan.FFmpeg'} onFocus={event => event.currentTarget.select()} /></li>
      <li>설치가 끝나면 <b>다시 찾기</b>를 누릅니다.</li>
    </ol>
    <p className="hint">이미 설치했다면 ffmpeg{isMac ? '' : '.exe'} 파일 위치를 직접 지정할 수 있습니다. 지정한 위치는 다음 실행에도 기억합니다.</p>
    <div className="gif-setup-actions">
      <button className="primary" disabled={busy} onClick={() => act('tool', async () => {
        const status = unwrap(await api.locateGifTool()); setTool(status)
        onStatus(status.found ? 'ffmpeg를 찾았습니다.' : 'ffmpeg를 찾지 못했습니다. 설치가 끝났는지 확인하거나 위치를 지정하세요.')
      })}>다시 찾기</button>
      <button disabled={busy} onClick={() => act('tool', async () => { const status = unwrap(await api.chooseGifTool()); if (status) { setTool(status); onStatus('ffmpeg 위치를 저장했습니다.') } })}>ffmpeg 위치 선택</button>
    </div>
    {pending && <p className="hint">설치 후 {pending.name}을(를) 바로 불러옵니다.</p>}
  </section></div>

  const openVideo = () => act('tool', async () => { const ref = unwrap(await api.openVideo()); if (ref) setPending(ref) })
  if (!video) return <div className="gif-center">
    <div className="drop-target"><strong>{work === 'load' ? '미리보기를 만드는 중…' : '동영상을 이 창으로 끌어다 놓으세요'}</strong>
      <span>MOV·MP4 동영상(아이폰, 갤럭시, 카메라 등)에서 원하는 구간·영역만 골라 GIF나 MP4로 저장합니다.</span>
      <button disabled={busy} onClick={openVideo}>동영상 열기</button></div>
  </div>

  const span = range.end - range.start
  const limit = LIMIT[format]
  const frames = gifFrameCount({ ...range, fps })
  // Only send a crop that actually cuts something.
  const cut: VideoCrop | undefined = crop && (crop.width < video.width || crop.height < video.height) ? { x: crop.x, y: crop.y, width: crop.width, height: crop.height } : undefined
  const area = cut ? { width: even(cut.width), height: even(cut.height) } : video
  const times = { start: round(range.start), end: round(range.end) }
  const gifOptions = { ...times, width, fps, ...(cut ? { crop: cut } : {}) }
  const sizes = MP4_WIDTHS.filter(item => !item || item < area.width)
  const mp4Options = { ...times, width: sizes.includes(mp4Size as never) ? mp4Size : 0, audio: audio && video.hasAudio, ...(cut ? { crop: cut } : {}) }
  const outWidth = format === 'gif' ? Math.min(width, area.width) : mp4Width(mp4Options, video.width)
  const outHeight = format === 'gif' ? Math.max(1, Math.round(area.height * outWidth / area.width)) : Math.round(area.height * outWidth / area.width / 2) * 2
  const valid = format === 'gif' ? validGifOptions(gifOptions, video.duration) : validMp4Options(mp4Options, video.duration)
  const ratio = aspect === 'none' ? null : aspectRatio(aspect, video)
  function chooseAspect(next: VideoAspect) {
    setAspect(next)
    const { width, height } = video!
    if (next === 'none') { setCrop(null); return }
    // Free starts a little inside the frame so the handles are easy to grab; ratios start as large as fits.
    const box = next === 'free' ? { x: Math.round(width * 0.05), y: Math.round(height * 0.05), width: Math.round(width * 0.9), height: Math.round(height * 0.9) } : centeredCrop(video!, next)
    setCrop({ x: box.x, y: box.y, width: box.width, height: box.height })
  }
  function chooseFormat(next: Format) {
    setFormat(next); savePref('pk.videoFormat', next)
    if (range.end - range.start > LIMIT[next]) setRange(current => ({ start: current.start, end: round(current.start + LIMIT[next]) }))
  }
  const percent = (time: number) => `${time / video.duration * 100}%`
  const thumbs = Array.from({ length: 12 }, (_, index) => video.urls[Math.round(index * (video.urls.length - 1) / 11)])

  function setBoundary(which: 'start' | 'end', time: number) {
    const value = round(Math.min(video!.duration, Math.max(0, time)))
    setRange(current => {
      let { start, end } = current
      if (which === 'start') { start = Math.min(value, end - MIN_SPAN); if (end - start > limit) end = round(start + limit) }
      else { end = Math.max(value, start + MIN_SPAN); if (end - start > limit) start = round(end - limit) }
      start = Math.max(0, round(start)); end = Math.min(video!.duration, round(end))
      setPlayhead(head => Math.min(end, Math.max(start, head)))
      return { start, end }
    })
  }
  const timeAt = (clientX: number) => { const box = track.current!.getBoundingClientRect(); return (clientX - box.left) / box.width * video.duration }
  const dragHandle = (which: 'start' | 'end' | 'head') => (event: PointerEvent<HTMLElement>) => {
    if (busy) return
    event.preventDefault(); event.stopPropagation()
    setPlaying(false)
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    const move = (clientX: number) => { const time = timeAt(clientX); if (which === 'head') setPlayhead(Math.min(video.duration, Math.max(0, time))); else { setBoundary(which, time); setPlayhead(Math.min(video.duration, Math.max(0, time))) } }
    move(event.clientX)
    const onMove = (next: globalThis.PointerEvent) => move(next.clientX)
    const onUp = () => { target.removeEventListener('pointermove', onMove); target.removeEventListener('pointerup', onUp); target.removeEventListener('pointercancel', onUp) }
    target.addEventListener('pointermove', onMove); target.addEventListener('pointerup', onUp); target.addEventListener('pointercancel', onUp)
  }
  function handleKey(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement
    if (busy || event.altKey || target.closest('input, select, textarea')) return
    if (panel !== 'save' && (event.ctrlKey || event.metaKey)) {
      const key = event.key.toLowerCase()
      if (key === 'z' || key === 'y') { event.preventDefault(); if (key === 'y' || event.shiftKey) redo(); else undo() }
      return
    }
    if (event.ctrlKey || event.metaKey) return
    if (panel !== 'save' && (event.key === 'Delete' || event.key === 'Backspace') && scene.selectedId) { event.preventDefault(); remove(); return }
    if (panel !== 'save' && event.key === 'Escape' && scene.selectedId) { event.preventDefault(); select(null); return }
    const step = event.shiftKey ? 1 : 1 / video!.previewFps
    const actions: Record<string, () => void> = {
      '[': () => setBoundary('start', playhead), ']': () => setBoundary('end', playhead),
      ' ': () => setPlaying(value => !value),
      ArrowLeft: () => { setPlaying(false); setPlayhead(head => Math.max(0, head - step)) },
      ArrowRight: () => { setPlaying(false); setPlayhead(head => Math.min(video!.duration, head + step)) },
      Home: () => setPlayhead(range.start), End: () => setPlayhead(range.end)
    }
    const action = actions[event.key]
    if (!action || (event.key === ' ' && target.tagName === 'BUTTON')) return
    event.preventDefault(); action()
  }
  // 가리기·스티커 editing: one undo step per drag/handle change, slider changes become one step on release.
  const edit = (next: Scene) => { liveBase.current = null; setOverlay(history => commitScene(history, next)) }
  const select = (id: string | null) => setOverlay(history => ({ ...history, present: { ...history.present, selectedId: id } }))
  const selectedRegion = scene.regions.find(item => item.id === scene.selectedId) ?? null
  function changeItem(id: string, value: Placement) { if (validPlacement(value)) edit(updateSelected({ ...scene, selectedId: id }, value)) }
  function drawRegion(value: Placement) {
    if (scene.regions.length >= MAX_VIDEO_REGIONS) { onError(`동영상에는 가림 영역을 ${MAX_VIDEO_REGIONS}개까지 넣을 수 있습니다.`); return }
    edit(addRegion(scene, { id: crypto.randomUUID(), ...value, ...effect }))
  }
  function changeEffect(next: RegionEffect, live = false) {
    if (!validEffect(next)) return
    setEffect(next); savePref('pk.videoRegion', next)
    if (!selectedRegion) return
    if (!live) { edit(updateSelectedRegion(liveBase.current?.present ?? scene, next)); return }
    setOverlay(history => { liveBase.current ??= history; return { ...history, present: updateSelectedRegion(history.present, next) } })
  }
  function commitLive() {
    const base = liveBase.current
    if (!base) return
    liveBase.current = null
    setOverlay(history => commitScene(base, history.present))
  }
  const addSticker = (id: string) => act('tool', async () => {
    const sticker = assets.current.get(id) ?? await loadSticker(id)
    assets.current.set(id, sticker)
    const frame = video.frame, width = Math.min(sticker.width, frame.width / 3)
    const offset = Math.min((scene.stickers.length % 10) * 12, frame.width / 8)
    edit(addInstance(scene, { id: crypto.randomUUID(), assetId: id, x: frame.width / 2 + offset, y: frame.height / 2 + offset, width, height: width * sticker.height / sticker.width, rotation: 0, zOrder: 0 }))
    onStatus('스티커를 올렸습니다. 끌어서 옮기고 핸들로 크기·회전을 바꾸세요. 영상 전체 구간에 그대로 보입니다.')
  })
  const undo = () => { liveBase.current = null; setOverlay(undoScene) }
  const redo = () => { liveBase.current = null; setOverlay(redoScene) }
  const remove = () => { if (scene.selectedId) edit(removeSelected(scene)) }
  const label = format === 'gif' ? 'GIF' : 'MP4'
  const create = () => act('create', async () => {
    setPlaying(false); setProgress(0)
    onStatus(`${label}를 만드는 중…`)
    const overlays = await overlayRequest(scene, video.frame, video, assets.current)
    const receipt = unwrap(format === 'gif' ? await api.createGif(video.id, gifOptions, overlays) : await api.exportMp4(video.id, mp4Options, overlays))
    if (!receipt) { onStatus('저장이 취소되었습니다.'); return }
    onSaved(receipt)
    onStatus(`${label} 저장 완료 · ${receipt.name} · ${formatBytes(receipt.bytes)}`)
  })

  return <div className="gif-workspace" ref={root} tabIndex={-1} onKeyDown={handleKey} aria-label="동영상 편집">
    <div className="gif-main">
      {panel === 'save' ? <div className="gif-preview">
        <VideoCropBox video={video} crop={crop} ratio={ratio} disabled={busy} onChange={setCrop}>
          <img src={video.urls[frameIndex]} alt={`${video.name} 미리보기`} data-testid="gif-frame" data-index={frameIndex} />
          {placed > 0 && <canvas ref={previewCanvas} className="video-overlay-preview" data-testid="video-overlay-preview" aria-hidden="true" />}
        </VideoCropBox>
      </div> : frameBitmap ? <EditorCanvas key={video.id} photo={{ width: video.frame.width, height: video.frame.height, bitmap: frameBitmap }} assets={assets.current} scene={scene}
        disabled={busy} drawMode={panel === 'hide'} drawShape={effect.shape} onDraw={drawRegion} onSelect={select} onChange={changeItem}
        selectionTools={<button disabled={busy} onClick={remove} aria-label="선택 항목 삭제" title="Delete">🗑 삭제</button>}
        info={<>{panel === 'hide' ? '영상 위를 끌어서 가릴 곳을 그리세요' : '스티커를 끌어서 옮기세요'} · 영상 전체 구간에 적용</>} />
        : <div className="gif-preview"><p className="hint">프레임을 준비하는 중…</p></div>}
      <div className="gif-timeline">
        <button className="icon" aria-label={playing ? '일시 정지' : '구간 재생'} title="Space" disabled={busy} onClick={() => setPlaying(value => !value)}>{playing ? '❚❚' : '▶'}</button>
        <div className="gif-track" ref={track} data-testid="gif-track" onPointerDown={dragHandle('head')}>
          <div className="gif-thumbs" aria-hidden="true">{thumbs.map((url, index) => <img key={index} src={url} alt="" />)}</div>
          <div className="gif-dim" style={{ left: 0, width: percent(range.start) }} />
          <div className="gif-dim" style={{ left: percent(range.end), right: 0 }} />
          <div className="gif-range" style={{ left: percent(range.start), width: percent(span) }} />
          <button className="gif-handle start" aria-label="시작 핸들" title="[ 키로 현재 위치를 시작으로" style={{ left: percent(range.start) }} onPointerDown={dragHandle('start')} disabled={busy}>[</button>
          <button className="gif-handle end" aria-label="끝 핸들" title="] 키로 현재 위치를 끝으로" style={{ left: percent(range.end) }} onPointerDown={dragHandle('end')} disabled={busy}>]</button>
          <div className="gif-playhead" style={{ left: percent(playhead) }} />
        </div>
        <span className="gif-time" data-testid="gif-playhead">{playhead.toFixed(1)}s</span>
      </div>
      <p className="gif-keys">드래그로 구간 조절 · <kbd>[</kbd> 시작 지정 · <kbd>]</kbd> 끝 지정 · <kbd>Space</kbd> 재생 · <kbd>←</kbd><kbd>→</kbd> 이동(Shift 1초)</p>
    </div>
    <aside className="gif-side" aria-label="동영상 설정">
      <div className="pane-heading"><h2 title={video.name}>{video.name}</h2><button disabled={busy} onClick={openVideo}>다른 동영상</button></div>
      <p className="hint">{video.duration.toFixed(1)}초 · {video.width} × {video.height}{video.color !== 'sdr' ? ' · HDR' : ''}{video.hasAudio ? '' : ' · 소리 없음'}</p>
      <div className="side-tabs" role="tablist" aria-label="동영상 패널">
        <button role="tab" aria-selected={panel === 'save'} disabled={busy} onClick={() => { setPanel('save'); select(null) }}>저장</button>
        <button role="tab" aria-selected={panel === 'hide'} disabled={busy} onClick={() => { setPanel('hide'); select(null) }}>가리기{!!scene.regions.length && <span className="tab-count">{scene.regions.length}</span>}</button>
        <button role="tab" aria-selected={panel === 'sticker'} disabled={busy} onClick={() => { setPanel('sticker'); select(null) }}>스티커{!!scene.stickers.length && <span className="tab-count">{scene.stickers.length}</span>}</button>
      </div>
      {panel === 'hide' && <section className="region-panel video-region-panel" aria-label="동영상 가리기">
        <div className="region-fields" role="group" aria-label="가림 효과">
          <div className="field-row"><span>모양</span><div className="segmented" role="radiogroup" aria-label="가림 모양">
            {(['ellipse', 'rect'] as RegionShape[]).map(shape => <button key={shape} role="radio" aria-checked={effect.shape === shape} disabled={busy}
              onClick={() => changeEffect({ ...effect, shape })}>{shape === 'ellipse' ? '◯ 원형' : '▭ 사각형'}</button>)}
          </div></div>
          <div className="field-row"><span>방식</span><div className="segmented" role="radiogroup" aria-label="가림 방식">
            {(['blur', 'mosaic'] as RegionStyle[]).map(style => <button key={style} role="radio" aria-checked={effect.style === style} disabled={busy}
              onClick={() => changeEffect({ ...effect, style })}>{style === 'blur' ? '블러' : '모자이크'}</button>)}
          </div></div>
          <label>강도
            <input type="range" aria-label="가림 강도 슬라이더" min="1" max="100" step="1" disabled={busy} value={effect.strength}
              onChange={e => changeEffect({ ...effect, strength: e.target.valueAsNumber }, true)} onPointerUp={commitLive} onKeyUp={commitLive} onBlur={commitLive} />
            <input type="number" aria-label="가림 강도" min="1" max="100" step="1" disabled={busy} value={effect.strength}
              onChange={e => changeEffect({ ...effect, strength: e.target.valueAsNumber })} />
          </label>
          <p className="hint">{selectedRegion ? '선택한 영역에 적용됩니다.' : '영상 위를 끌어서 그리면 이 효과로 가립니다.'} 번호판·간판처럼 <b>자리가 고정된 것</b>을 가릴 때 쓰세요.</p>
        </div>
        <div className="pane-heading">
          <h2>가림 <small><span data-testid="video-region-count">{scene.regions.length}</span>/{MAX_VIDEO_REGIONS}</small></h2>
          <button className="link" disabled={busy || !scene.regions.length} onClick={() => edit(clearRegions(scene))}>모두 지우기</button>
        </div>
      </section>}
      {panel === 'sticker' && <div className="library-pane video-library">
        <LibraryPanel {...library} mode="pick" canUse disabled={library.disabled || busy} onUse={id => { void addSticker(id) }} />
      </div>}
      {panel === 'save' && <>
      {placed > 0 && <p className="hint" data-testid="video-placed">가림 {scene.regions.length}개 · 스티커 {scene.stickers.length}개를 영상 전체에 넣어 저장합니다.</p>}
      <div className="segmented" role="radiogroup" aria-label="저장 형식">
        {(['gif', 'mp4'] as Format[]).map(item => <button key={item} role="radio" aria-checked={format === item} disabled={busy} onClick={() => chooseFormat(item)}>
          {item === 'gif' ? 'GIF · 움짤' : 'MP4 · 동영상'}</button>)}
      </div>
      <div className="gif-fields">
        <label>시작 (초)<input type="number" aria-label="시작 시간" min="0" step="0.1" disabled={busy} value={range.start} onChange={e => Number.isFinite(e.target.valueAsNumber) && setBoundary('start', e.target.valueAsNumber)} /></label>
        <label>끝 (초)<input type="number" aria-label="끝 시간" min="0" step="0.1" disabled={busy} value={range.end} onChange={e => Number.isFinite(e.target.valueAsNumber) && setBoundary('end', e.target.valueAsNumber)} /></label>
        <label className="wide">자르기<select aria-label="자르기 비율" disabled={busy} value={aspect} onChange={e => chooseAspect(e.target.value as VideoAspect)}>
          {VIDEO_ASPECTS.map(item => <option key={item} value={item}>{item === 'none' ? '자르지 않음' : item === 'free' ? '자유 비율' : `${item} · ${CROP_LABELS[item].use}`}</option>)}</select></label>
        {format === 'gif' ? <>
          <label>너비<select aria-label="GIF 너비" disabled={busy} value={width} onChange={e => { const v = Number(e.target.value); setWidth(v); savePref('pk.gifWidth', v) }}>
            {GIF_WIDTHS.map(item => <option key={item} value={item}>{item}px</option>)}</select></label>
          <label>FPS<select aria-label="GIF FPS" disabled={busy} value={fps} onChange={e => { const v = Number(e.target.value); setFps(v); savePref('pk.gifFps', v) }}>
            {GIF_FPS.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
        </> : <>
          <label>너비<select aria-label="MP4 너비" disabled={busy} value={mp4Options.width} onChange={e => { const v = Number(e.target.value); setMp4Size(v); savePref('pk.mp4Width', v) }}>
            {sizes.map(item => <option key={item} value={item}>{item ? `${item}px` : '원본 크기'}</option>)}</select></label>
          <label className="check"><input type="checkbox" aria-label="소리 포함" disabled={busy || !video.hasAudio} checked={audio && video.hasAudio}
            onChange={e => { setAudio(e.target.checked); savePref('pk.videoAudio', e.target.checked) }} />소리 포함</label>
        </>}
      </div>
      <dl className="gif-summary">
        <div><dt>길이</dt><dd data-testid="gif-span">{span.toFixed(1)}초</dd></div>
        {format === 'gif' ? <div><dt>프레임</dt><dd>{frames}개</dd></div> : <div><dt>소리</dt><dd data-testid="video-audio">{mp4Options.audio ? '포함' : '없음'}</dd></div>}
        <div><dt>결과 크기</dt><dd data-testid="gif-size">{outWidth} × {outHeight}</dd></div>
      </dl>
      {format === 'gif' && span > 10 && <p className="hint">10초가 넘으면 GIF 용량이 커집니다. 너비나 FPS를 낮춰 보세요.</p>}
      {video.color !== 'sdr' && <p className="hint">HDR 영상입니다. 색이 바래지 않도록 일반 화면 색(SDR)으로 바꿔 저장합니다.</p>}
      {!valid && <p role="alert">{format === 'gif' ? `구간은 0.1~${MAX_GIF_SECONDS}초, 프레임은 600개 이하여야 합니다.` : `구간은 0.1초~${formatSeconds(MAX_MP4_SECONDS)}여야 합니다.`}</p>}
      </>}
      <div className="gif-footer">
      <div className="gif-output">
        <span>출력 폴더</span>
        <span className="folder-name" title={outputFolder ?? undefined}>{outputFolder ?? '미지정 · 저장 시 선택'}</span>
      </div>
      {work === 'create' ? <div className="gif-progress">
        <progress max={1} value={progress} aria-label={`${label} 만드는 중`} />
        <button onClick={() => { void api.cancelGif() }}>취소</button>
      </div> : <button className="primary gif-save" disabled={busy || !valid} onClick={create}>{label}로 저장</button>}
      <p className="hint">원본 동영상은 바꾸지 않고 <b>원본이름_kkumi.{format}</b>로 새로 저장합니다. 원본보다 크게 늘리지 않습니다.</p>
      </div>
    </aside>
  </div>
}
