import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Stage, Layer, Image as CanvasImage, Transformer, Group } from 'react-konva'
import type Konva from 'konva'
import type { ImageAsset, PhotoApi, Placement, StickerInstance } from '../shared/model'
import { fitScale, validPlacement } from '../shared/model'
import type { LibrarySticker, StickerMetadata } from '../shared/library'
import { LibraryPanel } from './LibraryPanel'
import { composePng } from './export'
import './style.css'

declare global { interface Window { photokkumi: PhotoApi } }
interface DecodedAsset extends Omit<ImageAsset, 'bytes'> { bitmap: ImageBitmap }
async function decode(asset: ImageAsset): Promise<DecodedAsset> {
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(asset.bytes)], { type: asset.mime }), { imageOrientation: 'from-image' })
  if (bitmap.width !== asset.width || bitmap.height !== asset.height) {
    bitmap.close()
    throw new Error('이미지의 방향 또는 크기를 확인할 수 없습니다.')
  }
  return { id: asset.id, name: asset.name, width: asset.width, height: asset.height, mime: asset.mime, bitmap }
}
function EditorCanvas({ photo, sticker, placement, disabled, onChange }: {
  photo: DecodedAsset; sticker: DecodedAsset | null; placement: StickerInstance | null; disabled: boolean; onChange: (value: Placement) => void
}) {
  const area = useRef<HTMLDivElement>(null)
  const image = useRef<Konva.Image>(null)
  const transformer = useRef<Konva.Transformer>(null)
  const [size, setSize] = useState({ width: 600, height: 480 })
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width - 48, height: entry.contentRect.height - 48 }))
    observer.observe(area.current!)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (image.current && transformer.current) transformer.current.nodes([image.current])
  }, [sticker?.id])
  const scale = fitScale(photo.width, photo.height, size.width, size.height)
  return <div ref={area} className="canvas-area" data-testid="canvas-area">
    <div className="canvas-frame" data-testid="canvas-frame" data-scale={scale}>
      <Stage width={photo.width * scale} height={photo.height * scale} scaleX={scale} scaleY={scale}>
        <Layer ref={layer => { layer?.getNativeCanvasElement().setAttribute('data-testid', 'photo-content') }}>
          <Group clipX={0} clipY={0} clipWidth={photo.width} clipHeight={photo.height}>
            <CanvasImage image={photo.bitmap} width={photo.width} height={photo.height} listening={false} />
            {sticker && placement && <CanvasImage ref={image} image={sticker.bitmap}
              x={placement.x} y={placement.y} width={placement.width} height={placement.height}
              offsetX={placement.width / 2} offsetY={placement.height / 2} rotation={placement.rotation}
              draggable={!disabled} listening={!disabled}
              onDragEnd={event => onChange({ ...placement, x: event.target.x(), y: event.target.y() })}
              onTransformEnd={() => {
                const node = image.current!
                const next = { x: node.x(), y: node.y(), width: node.width() * node.scaleX(), height: node.height() * node.scaleY(), rotation: node.rotation() }
                node.scale({ x: 1, y: 1 })
                onChange(next)
              }} />}
          </Group>
        </Layer>
        <Layer ref={layer => { layer?.getNativeCanvasElement().setAttribute('data-testid', 'editor-overlay') }}>
          {sticker && placement && <Transformer ref={transformer} enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
            keepRatio flipEnabled={false} rotateEnabled={!disabled} resizeEnabled={!disabled}
            boundBoxFunc={(oldBox, newBox) => Math.abs(newBox.width) < 4 || Math.abs(newBox.height) < 4 || Math.abs(newBox.width) > 32768 * scale || Math.abs(newBox.height) > 32768 * scale ? oldBox : newBox} />}
        </Layer>
      </Stage>
    </div>
  </div>
}
function App() {
  const [photo, setPhoto] = useState<DecodedAsset | null>(null)
  const [sticker, setSticker] = useState<DecodedAsset | null>(null)
  const [placement, setPlacement] = useState<StickerInstance | null>(null)
  const [busy, setBusy] = useState(false)
  const operation = useRef(false)
  const [status, setStatus] = useState('사진 한 장을 열어 시작하세요.')
  const [error, setError] = useState('')
  const [libraryItems, setLibraryItems] = useState<LibrarySticker[]>([])
  const [dirty, setDirty] = useState(false)
  const [closeRequest, setCloseRequest] = useState<string | null>(null)
  const closeDialog = useRef<HTMLDialogElement>(null)
  useEffect(() => window.photokkumi.onCloseRequested(setCloseRequest), [])
  useEffect(() => {
    if (!closeRequest || busy) return
    if (!dirty) {
      void window.photokkumi.resolveClose({ requestId: closeRequest, action: 'close' }).then(result => {
        if (!result.ok) setError(result.error)
      })
    } else if (!closeDialog.current?.open) closeDialog.current?.showModal()
  }, [closeRequest, busy, dirty])
  useEffect(() => () => photo?.bitmap.close(), [photo])
  useEffect(() => () => sticker?.bitmap.close(), [sticker])

  async function run(action: () => Promise<void>) {
    if (operation.current) return
    operation.current = true; setBusy(true); setError('')
    try { await action() }
    catch (value) { setError(value instanceof Error ? value.message : '작업에 실패했습니다.') }
    finally { operation.current = false; setBusy(false) }
  }
  useEffect(() => { void run(async () => { await refreshLibrary() }) }, [])
  async function refreshLibrary() {
    const result = await window.photokkumi.listStickers()
    if (!result.ok) throw new Error(result.error)
    setLibraryItems(result.value)
  }
  async function libraryChange(action: () => Promise<import('../shared/model').Result<LibrarySticker[]>>): Promise<boolean> {
    let success = false
    await run(async () => {
      const result = await action()
      if (!result.ok) { await refreshLibrary(); throw new Error(result.error) }
      setLibraryItems(result.value); success = true
    })
    return success
  }
  const updateSticker = (id: string, metadata: StickerMetadata) => libraryChange(() => window.photokkumi.updateSticker(id, metadata))
  const deleteSticker = (id: string) => libraryChange(() => window.photokkumi.deleteSticker(id))
  const importStickers = () => run(async () => {
    const result = await window.photokkumi.importStickers()
    if (!result.ok) throw new Error(result.error)
    if (result.value) { setLibraryItems(result.value.stickers); setStatus('스티커를 등록했습니다. 같은 PNG는 중복 등록하지 않습니다.') }
  })
  const backupLibrary = () => run(async () => {
    const result = await window.photokkumi.backupLibrary()
    if (!result.ok) throw new Error(result.error)
    if (result.value) setStatus(`백업 완료 · ${result.value}`)
  })
  const restoreLibrary = () => run(async () => {
    const result = await window.photokkumi.restoreLibrary()
    if (!result.ok) throw new Error(result.error)
    if (result.value) { setLibraryItems(result.value); setStatus('복원 완료 · 기존 라이브러리에 병합했습니다.') }
  })
  function placeSticker(decoded: DecodedAsset) {
    if (!photo) { decoded.bitmap.close(); return }
    const width = Math.min(decoded.width, photo.width / 3)
    setSticker(decoded)
    setPlacement({ assetId: decoded.id, x: photo.width / 2, y: photo.height / 2, width, height: width * decoded.height / decoded.width, rotation: 0, zOrder: 0 })
    setDirty(true); setStatus('모서리 핸들로 크기, 위쪽 핸들로 회전을 조절하세요.')
  }
  const useSticker = (id: string) => run(async () => {
    const result = await window.photokkumi.useSticker(id)
    if (!result.ok) throw new Error(result.error)
    placeSticker(await decode(result.value))
  })
  function change(value: Placement) {
    if (!placement || !validPlacement(value)) return
    setPlacement({ ...placement, ...value }); setDirty(true); setStatus('수정됨 · 저장이 필요합니다.')
  }
  const choosePhoto = () => run(async () => {
    const result = await window.photokkumi.choosePhoto()
    if (!result.ok) throw new Error(result.error)
    if (!result.value) return
    const decoded = await decode(result.value)
    setPhoto(decoded); setSticker(null); setPlacement(null); setDirty(false)
    setStatus('라이브러리의 스티커를 클릭해 배치하세요.')
  })
  const chooseSticker = () => run(async () => {
    if (!photo) return
    const result = await window.photokkumi.chooseSticker()
    if (!result.ok) throw new Error(result.error)
    if (!result.value) return
    placeSticker(await decode(result.value))
    await refreshLibrary()
  })
  async function saveCurrent(): Promise<boolean> {
    if (!photo) return false
    const png = await composePng(photo.bitmap, sticker?.bitmap ?? null, placement)
    const result = await window.photokkumi.savePng({ photoId: photo.id, png })
    if (!result.ok) throw new Error(result.error)
    if (!result.value) { setStatus('저장이 취소되었습니다. 편집 내용은 유지됩니다.'); return false }
    setDirty(false); setStatus(`저장 완료 · ${result.value}`)
    return true
  }
  const save = () => run(async () => { await saveCurrent() })
  async function resolveClose(action: 'close' | 'cancel') {
    if (!closeRequest) return
    const requestId = closeRequest
    const result = await window.photokkumi.resolveClose({ requestId, action })
    if (!result.ok) throw new Error(result.error)
    closeDialog.current?.close()
    setCloseRequest(current => current === requestId ? null : current)
  }
  const cancelClose = () => { void resolveClose('cancel').catch(value => setError(String(value))) }
  const saveAndClose = () => run(async () => {
    try {
      if (await saveCurrent()) await resolveClose('close')
      else await resolveClose('cancel')
    } catch (error) {
      await resolveClose('cancel')
      throw error
    }
  })
  return <main>
    <dialog ref={closeDialog} aria-labelledby="close-title" onCancel={event => { event.preventDefault(); if (!busy) cancelClose() }}>
      <h2 id="close-title">저장하지 않은 편집</h2>
      <p>편집한 사진을 저장하고 닫을까요?</p>
      <div className="close-actions">
        <button disabled={busy} onClick={saveAndClose}>저장</button>
        <button disabled={busy} onClick={() => { void resolveClose('close').catch(value => setError(String(value))) }}>버리기</button>
        <button disabled={busy} autoFocus onClick={cancelClose}>취소</button>
      </div>
    </dialog>
    <header><div><h1>포토꾸미</h1><p>사진 한 장에 나만의 PNG 스티커</p></div><span className="badge">단계 B</span></header>
    <nav aria-label="파일 작업">
      <button onClick={choosePhoto} disabled={busy || !!photo}>사진 열기</button>
      <button onClick={chooseSticker} disabled={busy || !photo}>PNG 스티커 열기</button>
      <button className="primary" onClick={save} disabled={busy || !photo}>{busy ? '처리 중…' : 'PNG로 저장'}</button>
    </nav>
    <section className="workspace">
      {photo ? <EditorCanvas photo={photo} sticker={sticker} placement={placement} disabled={busy} onChange={change} />
        : <div className="empty">사진을 열면 이곳에서 편집할 수 있습니다.<small>사진 JPG/PNG · 스티커 PNG · 결과는 원본 크기 PNG</small></div>}
      <aside>
        <LibraryPanel items={libraryItems} disabled={busy} canUse={!!photo} activeId={placement?.assetId ?? null}
          onUse={useSticker} onImport={importStickers} onBackup={backupLibrary} onRestore={restoreLibrary}
          onUpdate={updateSticker} onDelete={deleteSticker} />
        <h2>스티커 배치</h2>
        <p>스티커를 드래그해 이동하세요. 모서리로 비율을 유지하며 크기를 바꾸고, 위쪽 핸들로 회전하세요.</p>
        {placement && <fieldset disabled={busy}>
          <label>중심 X<input aria-label="중심 X" type="number" value={Math.round(placement.x * 100) / 100} onChange={e => change({ ...placement, x: e.target.valueAsNumber })} /></label>
          <label>중심 Y<input aria-label="중심 Y" type="number" value={Math.round(placement.y * 100) / 100} onChange={e => change({ ...placement, y: e.target.valueAsNumber })} /></label>
          <label>너비<input aria-label="스티커 너비" type="number" min="1" max="32768" value={Math.round(placement.width * 100) / 100} onChange={e => change({ ...placement, width: e.target.valueAsNumber, height: e.target.valueAsNumber * placement.height / placement.width })} /></label>
          <label>회전 (°)<input aria-label="회전" type="number" value={Math.round(placement.rotation * 100) / 100} onChange={e => change({ ...placement, rotation: e.target.valueAsNumber })} /></label>
        </fieldset>}
        <small>위치와 크기는 원본 픽셀 기준입니다.</small>
        {photo && <p className="file-info">{photo.name}<br />{photo.width} × {photo.height} px<br />{dirty ? '수정됨' : '원본 / 저장됨'}</p>}
        {sticker && <p className="file-info">스티커: {sticker.name}</p>}
      </aside>
    </section>
    <footer><p role="status" aria-live="polite">{status}</p>{error && <p role="alert">{error}</p>}<small>원본은 바꾸지 않습니다. 새 PNG 파일로 저장합니다. 다른 사진 작업은 앱을 다시 열어 시작하세요.</small></footer>
  </main>
}
createRoot(document.getElementById('root')!).render(<App />)
