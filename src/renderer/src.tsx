import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createRoot } from 'react-dom/client'
import type { ImageAsset, PhotoApi, Placement } from '../shared/model'
import { validPlacement } from '../shared/model'
import type { LibrarySticker, StickerMetadata } from '../shared/library'
import { LibraryPanel } from './LibraryPanel'
import { EditorCanvas } from './EditorCanvas'
import { addInstance, updateSelected, removeSelected, duplicateSelected, reorderSelected, emptyHistory, commitScene, undoScene, redoScene, referencedAssets, MAX_INSTANCES, MAX_DECODED_STICKER_PIXELS, type Scene, type SceneHistory } from '../shared/scene'
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
function App() {
  const [photo, setPhoto] = useState<DecodedAsset | null>(null)
  const [history, setHistory] = useState<SceneHistory>(emptyHistory)
  const currentHistory = useRef(history)
  const assets = useRef(new Map<string, DecodedAsset>())
  const scene = history.present
  const placement = scene.stickers.find(item => item.id === scene.selectedId) ?? null
  const sticker = placement ? assets.current.get(placement.assetId) : null
  const referencedIds = referencedAssets(history)
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
  useEffect(() => {
    const keep = new Set(referencedAssets(history))
    for (const [id, asset] of assets.current) if (!keep.has(id)) { asset.bitmap.close(); assets.current.delete(id) }
  }, [history])
  useEffect(() => {
    const cache = assets.current
    return () => { for (const asset of cache.values()) asset.bitmap.close(); cache.clear() }
  }, [])
  async function syncReferences(next: SceneHistory) {
    if (!photo) return
    const result = await window.photokkumi.setStickerReferences(photo.id, referencedAssets(next))
    if (!result.ok) throw new Error(result.error)
  }
  function applyHistory(next: SceneHistory) {
    currentHistory.current = next; setHistory(next)
    setDirty(true); setStatus('수정됨 · 저장이 필요합니다.')
    void syncReferences(next).catch(value => setError(String(value)))
  }
  function editScene(next: Scene) { applyHistory(commitScene(currentHistory.current, next)) }
  function selectInstance(id: string | null) {
    if (operation.current || currentHistory.current.present.selectedId === id) return
    const next = { ...currentHistory.current, present: { ...currentHistory.current.present, selectedId: id } }
    currentHistory.current = next; setHistory(next)
  }

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
      for (const item of result.value) { const cached = assets.current.get(item.id); if (cached) cached.name = item.name }
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
  async function placeSticker(asset: ImageAsset) {
    if (!photo) return
    try {
      if (currentHistory.current.present.stickers.length >= MAX_INSTANCES) throw new Error('사진 한 장에는 스티커를 최대 200개 배치할 수 있습니다.')
      let decoded = assets.current.get(asset.id)
      if (!decoded) {
        const total = [...assets.current.values()].reduce((sum, item) => sum + item.width * item.height, 0)
        if (total + asset.width * asset.height > MAX_DECODED_STICKER_PIXELS) throw new Error('스티커 이미지 메모리 한도입니다. 배치·실행취소 이력을 비운 뒤 다시 시도하세요.')
        decoded = await decode(asset)
        assets.current.set(asset.id, decoded)
      }
      const width = Math.min(decoded.width, photo.width / 3)
      const offset = Math.min((currentHistory.current.present.stickers.length % 10) * 20, photo.width / 8, photo.height / 8)
      editScene(addInstance(currentHistory.current.present, {
        id: crypto.randomUUID(), assetId: decoded.id, x: photo.width / 2 + offset, y: photo.height / 2 + offset,
        width, height: width * decoded.height / decoded.width, rotation: 0, zOrder: 0
      }))
      setStatus('스티커를 추가했습니다. 클릭해 선택하고 각각 이동·크기·회전을 조절하세요.')
    } finally { await syncReferences(currentHistory.current) }
  }
  const useSticker = (id: string) => run(async () => {
    const cached = assets.current.get(id)
    if (cached) { await placeSticker({ ...cached, bytes: new Uint8Array() }); return }
    const result = await window.photokkumi.useSticker(id)
    if (!result.ok) throw new Error(result.error)
    await placeSticker(result.value)
  })
  function change(value: Placement, id = placement?.id) {
    if (!id || !validPlacement(value)) return
    const current = currentHistory.current.present
    editScene(updateSelected({ ...current, selectedId: id }, value))
  }
  function handleEditorKey(event: KeyboardEvent<HTMLElement>) {
    const target = event.target
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey
      || operation.current || closeRequest || (target instanceof HTMLElement
        && (target.isContentEditable || target.closest('input, textarea, select, dialog, [role="textbox"]')))) return
    const current = currentHistory.current.present
    const selected = current.stickers.find(item => item.id === current.selectedId)
    if (!selected) return
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      if (!event.repeat) editScene(removeSelected(current))
      return
    }
    const step = event.shiftKey ? 10 : 1
    const offset: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step]
    }
    const delta = offset[event.key]
    if (!delta) return
    event.preventDefault()
    change({ ...selected, x: selected.x + delta[0], y: selected.y + delta[1] }, selected.id)
  }
  const duplicate = () => run(async () => { editScene(duplicateSelected(currentHistory.current.present, crypto.randomUUID())) })
  const clearScene = () => {
    if (!window.confirm('사진의 모든 스티커와 실행취소 이력을 비울까요? 이 작업은 실행 취소할 수 없습니다.')) return
    const next = emptyHistory()
    applyHistory(next)
  }
  const choosePhoto = () => run(async () => {
    const result = await window.photokkumi.choosePhoto()
    if (!result.ok) throw new Error(result.error)
    if (!result.value) return
    const decoded = await decode(result.value)
    setPhoto(decoded); currentHistory.current = emptyHistory(); setHistory(currentHistory.current); setDirty(false)
    setStatus('라이브러리의 스티커를 클릭해 배치하세요.')
  })
  const chooseSticker = () => run(async () => {
    if (!photo) return
    const result = await window.photokkumi.chooseSticker()
    if (!result.ok) throw new Error(result.error)
    if (!result.value) return
    await placeSticker(result.value)
    await refreshLibrary()
  })
  async function saveCurrent(): Promise<boolean> {
    if (!photo) return false
    const png = await composePng(photo.bitmap, currentHistory.current.present.stickers, assets.current)
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
  return <main onKeyDown={handleEditorKey}>
    <dialog ref={closeDialog} aria-labelledby="close-title" onCancel={event => { event.preventDefault(); if (!busy) cancelClose() }}>
      <h2 id="close-title">저장하지 않은 편집</h2>
      <p>편집한 사진을 저장하고 닫을까요?</p>
      <div className="close-actions">
        <button disabled={busy} onClick={saveAndClose}>저장</button>
        <button disabled={busy} onClick={() => { void resolveClose('close').catch(value => setError(String(value))) }}>버리기</button>
        <button disabled={busy} autoFocus onClick={cancelClose}>취소</button>
      </div>
    </dialog>
    <header><div><h1>포토꾸미</h1><p>사진 한 장에 여러 PNG 스티커</p></div><span className="badge">한 장 편집</span></header>
    <nav aria-label="파일 작업">
      <button onClick={choosePhoto} disabled={busy || !!photo}>사진 열기</button>
      <button onClick={chooseSticker} disabled={busy || !photo}>PNG 스티커 열기</button>
      <button className="primary" onClick={save} disabled={busy || !photo}>{busy ? '처리 중…' : 'PNG로 저장'}</button>
    </nav>
    <section className="workspace">
      {photo ? <EditorCanvas photo={photo} assets={assets.current} scene={scene} disabled={busy} onSelect={selectInstance} onChange={(id, value) => change(value, id)} />
        : <div className="empty">사진을 열면 이곳에서 편집할 수 있습니다.<small>사진 JPG/PNG · 스티커 PNG · 결과는 원본 크기 PNG</small></div>}
      <aside>
        <LibraryPanel items={libraryItems} disabled={busy} canUse={!!photo} activeIds={referencedIds}
          onUse={useSticker} onImport={importStickers} onBackup={backupLibrary} onRestore={restoreLibrary}
          onUpdate={updateSticker} onDelete={deleteSticker} />
        <h2>사진에 붙인 스티커 <span data-testid="instance-count">{scene.stickers.length}</span>/200</h2>
        <div className="instance-tools">
          <button disabled={busy || !history.past.length} onClick={() => applyHistory(undoScene(currentHistory.current))}>실행 취소</button>
          <button disabled={busy || !history.future.length} onClick={() => applyHistory(redoScene(currentHistory.current))}>다시 실행</button>
          <button disabled={busy || !referencedIds.length} onClick={clearScene}>배치·이력 비우기</button>
        </div>
        <div className="instance-list" aria-label="사진의 스티커 목록">
          {scene.stickers.map((item, index) => <button key={item.id} disabled={busy}
            aria-label={`배치 ${index + 1}: ${assets.current.get(item.assetId)?.name ?? '스티커'}`} aria-pressed={scene.selectedId === item.id}
            onClick={() => selectInstance(item.id)}>{index + 1}. {assets.current.get(item.assetId)?.name ?? '스티커'}</button>)}
        </div>
        <div className="instance-tools">
          <button disabled={busy || !placement} onClick={duplicate}>선택 복제</button>
          <button disabled={busy || !placement} onClick={() => editScene(removeSelected(currentHistory.current.present))}>선택 삭제</button>
          <button disabled={busy || !placement || placement.zOrder === 0} onClick={() => editScene(reorderSelected(currentHistory.current.present, -1))}>뒤로</button>
          <button disabled={busy || !placement || placement.zOrder === scene.stickers.length - 1} onClick={() => editScene(reorderSelected(currentHistory.current.present, 1))}>앞으로</button>
        </div>
        <p>스티커를 드래그해 이동하세요. 모서리로 비율을 유지하며 크기를 바꾸고, 위쪽 핸들로 회전하세요. 선택 후 방향키로 1px, Shift+방향키로 10px 이동하고 Delete·Backspace로 삭제합니다.</p>
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
