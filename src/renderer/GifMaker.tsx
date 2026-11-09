import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { DEFAULT_GIF, GIF_FPS, GIF_WIDTHS, MAX_GIF_SECONDS, gifFrameCount, validGifOptions, type GifReceipt, type ToolStatus, type VideoRef } from '../shared/gif'

interface Loaded { id: string; name: string; duration: number; width: number; height: number; previewFps: number; urls: string[] }
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
}
const MIN_SPAN = 0.1
const round = (value: number) => Math.round(value * 1000) / 1000
const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent)
const formatBytes = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`

export function GifMaker({ incoming, outputFolder, onSaved, onStatus, onError, onBusyChange, active }: Props) {
  const api = window.photokkumi
  const [tool, setTool] = useState<ToolStatus | null>(null)
  const [video, setVideo] = useState<Loaded | null>(null)
  const [pending, setPending] = useState<VideoRef | null>(null)
  const [work, setWork] = useState<'tool' | 'load' | 'create' | null>(null)
  const [range, setRange] = useState({ start: 0, end: 0 })
  const [playhead, setPlayhead] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [width, setWidth] = useState<number>(DEFAULT_GIF.width)
  const [fps, setFps] = useState<number>(DEFAULT_GIF.fps)
  const [progress, setProgress] = useState(0)
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

  const load = useCallback((ref: VideoRef) => act('load', async () => {
    setPlaying(false)
    onStatus(`${ref.name} · 미리보기를 만드는 중…`)
    const info = unwrap(await api.loadVideo(ref.id))
    const urls = info.frames.map(bytes => URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' })))
    setVideo(previous => { previous?.urls.forEach(url => URL.revokeObjectURL(url)); return { ...info, urls } })
    const end = round(Math.min(info.duration, 3))
    setRange({ start: 0, end }); setPlayhead(0)
    onStatus(`${info.name} · ${info.duration.toFixed(1)}초 · 사용할 구간을 [ ] 로 고른 뒤 GIF로 저장하세요.`)
    root.current?.focus({ preventScroll: true })
  }), [act, api, onStatus])
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
    <h2>GIF 만들기에는 ffmpeg가 필요합니다</h2>
    <p>포토꾸미는 ffmpeg를 포함하지 않습니다. 무료 프로그램인 ffmpeg를 직접 설치하면 아이폰 MOV(HEVC)도 GIF로 만들 수 있습니다.</p>
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
      <span>아이폰 MOV, MP4에서 원하는 구간만 골라 GIF로 만듭니다.</span>
      <button disabled={busy} onClick={openVideo}>동영상 열기</button></div>
  </div>

  const span = range.end - range.start
  const frames = gifFrameCount({ ...range, fps })
  const outWidth = Math.min(width, video.width), outHeight = Math.max(1, Math.round(video.height * outWidth / video.width))
  const options = { start: round(range.start), end: round(range.end), width, fps }
  const valid = validGifOptions(options, video.duration)
  const frameIndex = Math.min(video.urls.length - 1, Math.max(0, Math.floor(playhead * video.previewFps)))
  const percent = (time: number) => `${time / video.duration * 100}%`
  const thumbs = Array.from({ length: 12 }, (_, index) => video.urls[Math.round(index * (video.urls.length - 1) / 11)])

  function setBoundary(which: 'start' | 'end', time: number) {
    const value = round(Math.min(video!.duration, Math.max(0, time)))
    setRange(current => {
      let { start, end } = current
      if (which === 'start') { start = Math.min(value, end - MIN_SPAN); if (end - start > MAX_GIF_SECONDS) end = round(start + MAX_GIF_SECONDS) }
      else { end = Math.max(value, start + MIN_SPAN); if (end - start > MAX_GIF_SECONDS) start = round(end - MAX_GIF_SECONDS) }
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
    if (busy || event.ctrlKey || event.metaKey || event.altKey || target.closest('input, select, textarea')) return
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
  const create = () => act('create', async () => {
    setPlaying(false); setProgress(0)
    onStatus('GIF를 만드는 중…')
    const receipt = unwrap(await api.createGif(video.id, options))
    if (!receipt) { onStatus('저장이 취소되었습니다.'); return }
    onSaved(receipt)
    onStatus(`GIF 저장 완료 · ${receipt.name} · ${formatBytes(receipt.bytes)}`)
  })

  return <div className="gif-workspace" ref={root} tabIndex={-1} onKeyDown={handleKey} aria-label="GIF 만들기">
    <div className="gif-main">
      <div className="gif-preview">
        <img src={video.urls[frameIndex]} alt={`${video.name} 미리보기`} data-testid="gif-frame" data-index={frameIndex} />
      </div>
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
    <aside className="gif-side" aria-label="GIF 설정">
      <div className="pane-heading"><h2 title={video.name}>{video.name}</h2><button disabled={busy} onClick={openVideo}>다른 동영상</button></div>
      <p className="hint">{video.duration.toFixed(1)}초 · {video.width} × {video.height}</p>
      <div className="gif-fields">
        <label>시작 (초)<input type="number" aria-label="시작 시간" min="0" step="0.1" disabled={busy} value={range.start} onChange={e => Number.isFinite(e.target.valueAsNumber) && setBoundary('start', e.target.valueAsNumber)} /></label>
        <label>끝 (초)<input type="number" aria-label="끝 시간" min="0" step="0.1" disabled={busy} value={range.end} onChange={e => Number.isFinite(e.target.valueAsNumber) && setBoundary('end', e.target.valueAsNumber)} /></label>
        <label>너비<select aria-label="GIF 너비" disabled={busy} value={width} onChange={e => setWidth(Number(e.target.value))}>
          {GIF_WIDTHS.map(item => <option key={item} value={item}>{item}px</option>)}</select></label>
        <label>FPS<select aria-label="GIF FPS" disabled={busy} value={fps} onChange={e => setFps(Number(e.target.value))}>
          {GIF_FPS.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
      </div>
      <dl className="gif-summary">
        <div><dt>길이</dt><dd data-testid="gif-span">{span.toFixed(1)}초</dd></div>
        <div><dt>프레임</dt><dd>{frames}개</dd></div>
        <div><dt>결과 크기</dt><dd data-testid="gif-size">{outWidth} × {outHeight}</dd></div>
      </dl>
      {span > 10 && <p className="hint">10초가 넘으면 GIF 용량이 커집니다. 너비나 FPS를 낮춰 보세요.</p>}
      {!valid && <p role="alert">구간은 0.1~{MAX_GIF_SECONDS}초, 프레임은 600개 이하여야 합니다.</p>}
      <div className="gif-footer">
      <div className="gif-output">
        <span>출력 폴더</span>
        <span className="folder-name" title={outputFolder ?? undefined}>{outputFolder ?? '미지정 · 저장 시 선택'}</span>
      </div>
      {work === 'create' ? <div className="gif-progress">
        <progress max={1} value={progress} aria-label="GIF 만드는 중" />
        <button onClick={() => { void api.cancelGif() }}>취소</button>
      </div> : <button className="primary gif-save" disabled={busy || !valid} onClick={create}>GIF로 저장</button>}
      <p className="hint">원본 동영상은 바꾸지 않고 <b>원본이름_kkumi.gif</b>로 새로 저장합니다. 원본보다 크게 늘리지 않습니다.</p>
      </div>
    </aside>
  </div>
}
