import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createRoot } from 'react-dom/client'
import type { ImageAsset, PhotoApi, PhotoInfo, Placement } from '../shared/model'
import { validPlacement } from '../shared/model'
import type { LibrarySticker, StickerMetadata } from '../shared/library'
import { LibraryPanel } from './LibraryPanel'
import { EditorCanvas } from './EditorCanvas'
import { addInstance, updateSelected, removeSelected, duplicateSelected, reorderSelected, emptyHistory, commitScene, undoScene, redoScene, MAX_INSTANCES, MAX_DECODED_STICKER_PIXELS, type Scene, type SceneHistory } from '../shared/scene'
import { createPhotoSession, editPhotoSession, savePhotoSession, discardPhotoSession, sessionAssets, type PhotoSession } from '../shared/photo-session'
import { DEFAULT_OUTPUT, validOutput, outputSize, outputKey, type OutputSettings } from '../shared/output'
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
  const [output, setOutput] = useState<OutputSettings>({ ...DEFAULT_OUTPUT })
  const [outputLoaded, setOutputLoaded] = useState(false)
  const outputWrite = useRef<Promise<void>>(Promise.resolve())
  const [outputFolder, setOutputFolder] = useState<string | null>(null)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const libraryDialog = useRef<HTMLDialogElement>(null)
  const [photos, setPhotos] = useState<PhotoInfo[]>([])
  const sessions = useRef(new Map<string, PhotoSession>())
  const activeId = useRef<string | null>(null)
  const [pendingPhoto, setPendingPhoto] = useState<string | null>(null)
  const switchDialog = useRef<HTMLDialogElement>(null)
  const [photo, setPhoto] = useState<DecodedAsset | null>(null)
  const [history, setHistory] = useState<SceneHistory>(emptyHistory)
  const currentHistory = useRef(history)
  const assets = useRef(new Map<string, DecodedAsset>())
  const scene = history.present
  const placement = scene.stickers.find(item => item.id === scene.selectedId) ?? null
  const sticker = placement ? assets.current.get(placement.assetId) : null
  const activeSession = photo ? sessions.current.get(photo.id) : undefined
  const referencedAssetsForCurrent = activeSession ? sessionAssets(activeSession) : []
  const referencedIds = [...new Set([...sessions.current.values()].flatMap(sessionAssets))]
  const [busy, setBusy] = useState(false)
  const operation = useRef(false)
  const [status, setStatus] = useState('사진을 열어 시작하세요.')
  const [error, setError] = useState('')
  const [libraryItems, setLibraryItems] = useState<LibrarySticker[]>([])
  const [dirty, setDirty] = useState(false)
  const [closeRequest, setCloseRequest] = useState<string | null>(null)
  const closeDialog = useRef<HTMLDialogElement>(null)
  useEffect(() => window.photokkumi.onCloseRequested(setCloseRequest), [])
  useEffect(() => {
    if (!closeRequest || busy) return
    switchDialog.current?.close(); setPendingPhoto(null)
    libraryDialog.current?.close(); setLibraryOpen(false)
    if (!dirty) {
      void resolveClose('close').catch(value => setError(String(value)))
    } else if (!closeDialog.current?.open) closeDialog.current?.showModal()
  }, [closeRequest, busy, dirty])
  useEffect(() => { if (libraryOpen && !libraryDialog.current?.open) libraryDialog.current?.showModal() }, [libraryOpen])
  const closeLibrary = () => { if (!operation.current) { libraryDialog.current?.close(); setLibraryOpen(false) } }
  useEffect(() => () => photo?.bitmap.close(), [photo])
  useEffect(() => {
    const keep = new Set([...sessions.current.values()].flatMap(sessionAssets))
    for (const [id, asset] of assets.current) if (!keep.has(id)) { asset.bitmap.close(); assets.current.delete(id) }
  }, [history, photo, dirty])
  useEffect(() => {
    const cache = assets.current
    return () => { for (const asset of cache.values()) asset.bitmap.close(); cache.clear() }
  }, [])
  async function syncReferences(id = activeId.current) {
    if (!id) return
    const session = sessions.current.get(id)!
    const result = await window.photokkumi.setStickerReferences(id, sessionAssets(session))
    if (!result.ok) throw new Error(result.error)
  }
  function applyHistory(next: SceneHistory) {
    if (!activeId.current) return
    sessions.current.set(activeId.current, editPhotoSession(sessions.current.get(activeId.current)!, next))
    currentHistory.current = next; setHistory(next)
    setDirty(true); setStatus('수정됨 · 저장이 필요합니다.')
    void syncReferences().catch(value => setError(String(value)))
  }
  function editScene(next: Scene) { applyHistory(commitScene(currentHistory.current, next)) }
  function selectInstance(id: string | null) {
    if (operation.current || currentHistory.current.present.selectedId === id) return
    const next = { ...currentHistory.current, present: { ...currentHistory.current.present, selectedId: id } }
    if (activeId.current) sessions.current.get(activeId.current)!.history = next
    currentHistory.current = next; setHistory(next)
  }

  async function run(action: () => Promise<void>) {
    if (operation.current) return
    operation.current = true; setBusy(true); setError('')
    try { await action() }
    catch (value) { setError(value instanceof Error ? value.message : '작업에 실패했습니다.') }
    finally { operation.current = false; setBusy(false) }
  }
  useEffect(() => { void run(async () => {
    await refreshLibrary()
    const result = await window.photokkumi.getOutputSettings()
    if (!result.ok) throw new Error(result.error)
    setOutput(result.value); setOutputLoaded(true)
  }) }, [])
  useEffect(() => {
    if (!outputLoaded || !validOutput(output)) return
    const write = window.photokkumi.updateOutputSettings(output).then(result => { if (!result.ok) throw new Error(result.error) })
    outputWrite.current = write
    void write.catch(value => setError(String(value)))
  }, [output, outputLoaded])
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
    } finally { await syncReferences() }
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
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.altKey
      || operation.current || closeRequest || pendingPhoto || libraryOpen || (target instanceof HTMLElement
        && (target.isContentEditable || target.closest('input, textarea, select, dialog, [role="textbox"]')))) return
    if (event.ctrlKey || event.metaKey) {
      const key = event.key.toLowerCase()
      if (!photo || !['z', 'y', 'd'].includes(key)) return
      event.preventDefault()
      const history = currentHistory.current
      if (key === 'd') { if (history.present.selectedId && !event.repeat) void duplicate(); return }
      const next = key === 'y' || event.shiftKey ? redoScene(history) : undoScene(history)
      if (next !== history) applyHistory(next)
      return
    }
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
  async function activatePhoto(id: string, discard = false) {
    if (activeId.current === id) return
    const result = await window.photokkumi.readPhoto(id)
    if (!result.ok) throw new Error(result.error)
    const decoded = await decode(result.value)
    // Commit the switch only after a complete decode. A failed target keeps the current scene intact.
    if (discard && activeId.current) {
      const previous = activeId.current
      const original = sessions.current.get(previous)!
      sessions.current.set(previous, discardPhotoSession(original))
      try { await syncReferences(previous) }
      catch (error) { sessions.current.set(previous, original); decoded.bitmap.close(); throw error }
    }
    const session = sessions.current.get(id)!
    activeId.current = id
    currentHistory.current = session.history; setHistory(session.history)
    setPhoto(decoded); setDirty(session.dirty)
    setStatus(`${decoded.name} · 편집 중`)
  }
  const choosePhoto = () => run(async () => {
    const result = await window.photokkumi.choosePhotos()
    if (!result.ok) throw new Error(result.error)
    if (!result.value) return
    for (const item of result.value) if (!sessions.current.has(item.id)) sessions.current.set(item.id, createPhotoSession())
    setPhotos(result.value)
    if (!activeId.current && result.value[0]) await activatePhoto(result.value[0].id)
    setStatus('사진을 추가했습니다. 라이브러리의 스티커를 클릭해 배치하세요.')
  })
  const choosePhotoFolder = () => run(async () => {
    const result = await window.photokkumi.choosePhotoFolder()
    if (!result.ok) throw new Error(result.error)
    if (!result.value) return
    const { photos: imported, rejected } = result.value
    for (const item of imported) if (!sessions.current.has(item.id)) sessions.current.set(item.id, createPhotoSession())
    setPhotos(imported)
    if (!activeId.current && imported[0]) await activatePhoto(imported[0].id)
    setStatus(`사진 ${imported.length}장 · JPG/PNG만 가져옵니다.${rejected.length ? ` 읽을 수 없는 파일 ${rejected.length}개 제외: ${rejected.slice(0, 3).join(', ')}${rejected.length > 3 ? ' 외' : ''}` : ''}`)
  })
  const chooseOutputFolder = () => run(async () => {
    const result = await window.photokkumi.chooseOutputFolder()
    if (!result.ok) throw new Error(result.error)
    if (result.value) { setOutputFolder(result.value); setStatus('출력 폴더를 지정했습니다. 다음 저장부터 이 폴더를 사용합니다.') }
  })
  const requestPhoto = (id: string) => {
    if (operation.current || pendingPhoto || closeRequest || id === activeId.current) return
    if (dirty) { setPendingPhoto(id); switchDialog.current?.showModal() }
    else void run(() => activatePhoto(id))
  }
  const cancelSwitch = () => { switchDialog.current?.close(); setPendingPhoto(null) }
  const resolveSwitch = (action: 'save' | 'discard') => run(async () => {
    if (!pendingPhoto) return
    if (action === 'save' && !await saveCurrent()) { cancelSwitch(); return }
    await activatePhoto(pendingPhoto, action === 'discard')
    cancelSwitch()
  })
  async function saveCurrent(): Promise<boolean> {
    if (!photo) return false
    if (!outputLoaded) throw new Error('출력 설정을 불러온 뒤 저장할 수 있습니다.')
    outputSize(photo.width, photo.height, output)
    setStatus('저장 중…')
    const persisted = await window.photokkumi.updateOutputSettings(output)
    if (!persisted.ok) throw new Error(persisted.error)
    const png = await composePng(photo.bitmap, currentHistory.current.present.stickers, assets.current, output)
    const result = await window.photokkumi.saveImage({ photoId: photo.id, png, output })
    if (!result.ok) throw new Error(result.error)
    if (!result.value) { setStatus('저장이 취소되었습니다. 편집 내용은 유지됩니다.'); return false }
    sessions.current.set(photo.id, savePhotoSession(sessions.current.get(photo.id)!, outputKey(output), result.value.folderLabel))
    setOutputFolder(result.value.folderLabel)
    setDirty(false); setStatus(`저장 완료 · ${result.value.name}`)
    await syncReferences(photo.id)
    return true
  }
  const save = () => run(async () => { await saveCurrent() })
  const photoIndex = photos.findIndex(item => item.id === photo?.id)
  const saveNext = () => run(async () => {
    if (!photo) return
    const session = sessions.current.get(photo.id)!
    if ((session.dirty || !session.saved || session.outputKey !== outputKey(output) || session.savedFolder !== outputFolder) && !await saveCurrent()) return
    const next = photos[photoIndex + 1]
    if (next) await activatePhoto(next.id)
    else setStatus('마지막 사진까지 저장했습니다. 작업이 완료되었습니다.')
  })
  async function resolveClose(action: 'close' | 'cancel') {
    if (!closeRequest) return
    // A failed preference write must not trap the user in the app. Image saves
    // still fail explicitly in saveCurrent; discarding edits can always close.
    if (action === 'close') await outputWrite.current.catch(() => undefined)
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
  let outputError = '', outputLabel = ''
  try {
    if (!validOutput(output)) throw new Error('출력 길이는 1~8192 정수로 입력하세요. JPG 품질은 100입니다.')
    if (photo) { const size = outputSize(photo.width, photo.height, output); outputLabel = `${size.width} × ${size.height} px` }
  } catch (value) { outputError = value instanceof Error ? value.message : '출력 설정을 확인하세요.' }
  const libraryProps = { items: libraryItems, disabled: busy, canUse: !!photo, activeIds: referencedIds,
    onUse: useSticker, onImport: importStickers, onBackup: backupLibrary, onRestore: restoreLibrary,
    onUpdate: updateSticker, onDelete: deleteSticker }
  return <main onKeyDown={handleEditorKey}>
    <dialog ref={libraryDialog} className="library-dialog" aria-label="스티커 관리" onCancel={event => { event.preventDefault(); closeLibrary() }}>
      {libraryOpen && <>
        <div className="manager-heading"><h2>스티커 관리</h2><button disabled={busy} onClick={closeLibrary}>관리 닫기</button></div>
        <LibraryPanel {...libraryProps} mode="manage" />
        {error && <p role="alert">{error}</p>}
      </>}
    </dialog>
    <dialog ref={switchDialog} aria-labelledby="switch-title" onCancel={event => { event.preventDefault(); if (!busy) cancelSwitch() }}>
      <h2 id="switch-title">사진을 바꾸기 전 저장</h2>
      <p>현재 사진의 수정 내용을 저장할까요? 버리기를 선택하면 마지막 저장 상태로 돌아갑니다.</p>
      <div className="close-actions">
        <button disabled={busy} onClick={() => resolveSwitch('save')}>저장</button>
        <button disabled={busy} onClick={() => resolveSwitch('discard')}>버리기</button>
        <button disabled={busy} autoFocus onClick={cancelSwitch}>취소</button>
      </div>
      {error && <p role="alert">{error}</p>}
    </dialog>
    <dialog ref={closeDialog} aria-labelledby="close-title" onCancel={event => { event.preventDefault(); if (!busy) cancelClose() }}>
      <h2 id="close-title">저장하지 않은 편집</h2>
      <p>편집한 사진을 저장하고 닫을까요?</p>
      <div className="close-actions">
        <button disabled={busy} onClick={saveAndClose}>저장</button>
        <button disabled={busy} onClick={() => { void resolveClose('close').catch(value => setError(String(value))) }}>버리기</button>
        <button disabled={busy} autoFocus onClick={cancelClose}>취소</button>
      </div>
    </dialog>
    <header><div><h1>포토꾸미</h1><p>사진마다 스티커를 배치하고 저장하세요</p></div><span className="badge">{photo ? `${photoIndex + 1} / ${photos.length}` : '사진 편집'}</span></header>
    <nav aria-label="파일 작업">
      <button onClick={choosePhoto} disabled={busy || !!pendingPhoto}>사진 열기</button>
      <button onClick={choosePhotoFolder} disabled={busy || !!pendingPhoto}>입력 폴더 선택</button>
      <button onClick={chooseOutputFolder} disabled={busy}>출력 폴더 선택</button>
      <button onClick={saveNext} disabled={busy || !photo || !outputLoaded || !!outputError}>저장하고 다음</button>
      <button className="primary" onClick={save} disabled={busy || !photo || !outputLoaded || !!outputError}>{busy ? '처리 중…' : output.format === 'jpg' ? 'JPG로 저장' : 'PNG로 저장'}</button>
    </nav>
    <div className="output-folder" title={outputFolder ?? undefined}>출력 폴더: <span data-testid="output-folder">{outputFolder ?? '미지정 · 첫 저장 시 선택'}</span></div>
    <fieldset className="output-settings" disabled={busy || !outputLoaded} aria-label="출력 설정">
      <label>형식<select aria-label="출력 형식" value={output.format} onChange={e => setOutput({ ...output, format: e.target.value as 'png' | 'jpg' })}>
        <option value="png">PNG</option><option value="jpg">JPG</option>
      </select></label>
      <label><input type="checkbox" checked={output.resizeEnabled} onChange={e => setOutput({ ...output, resizeEnabled: e.target.checked })} />블로그 크기로 리사이즈</label>
      <label>기준<select aria-label="리사이즈 기준" disabled={!output.resizeEnabled} value={output.resizeBasis} onChange={e => setOutput({ ...output, resizeBasis: e.target.value as 'width' | 'longEdge' })}>
        <option value="width">가로 너비</option><option value="longEdge">긴 축</option>
      </select></label>
      <label>가로 사진<input aria-label="가로 사진 길이" type="number" min="1" max="8192" disabled={!output.resizeEnabled} value={Number.isFinite(output.landscapeSize) ? output.landscapeSize : ''} onChange={e => setOutput({ ...output, landscapeSize: e.target.valueAsNumber })} />px</label>
      <label>세로 사진<input aria-label="세로 사진 길이" type="number" min="1" max="8192" disabled={!output.resizeEnabled} value={Number.isFinite(output.portraitSize) ? output.portraitSize : ''} onChange={e => setOutput({ ...output, portraitSize: e.target.valueAsNumber })} />px</label>
      <label><input type="checkbox" checked={output.preventUpscale} onChange={e => setOutput({ ...output, preventUpscale: e.target.checked })} />확대 방지</label>
      <label>JPG 품질<input aria-label="JPG 품질" type="number" min="100" max="100" step="1" disabled value={Number.isFinite(output.quality) ? output.quality : ''} readOnly /></label>
      <span data-testid="output-size">{outputLabel}</span>
      {outputError && <span role="alert">{outputError}</span>}
    </fieldset>
    <section className="workspace">
      {photo ? <EditorCanvas key={photo.id} photo={photo} assets={assets.current} scene={scene} disabled={busy} onSelect={selectInstance} onChange={(id, value) => change(value, id)} />
        : <div className="empty">사진을 열면 이곳에서 편집할 수 있습니다.<small>사진 여러 장 JPG/PNG · 스티커 PNG · 결과는 JPG/PNG</small></div>}
      <aside>
        <button className="manage-library" disabled={busy} onClick={() => setLibraryOpen(true)}>스티커 관리</button>
        <div hidden={libraryOpen}><LibraryPanel {...libraryProps} mode="pick" /></div>
        <h2>사진에 붙인 스티커 <span data-testid="instance-count">{scene.stickers.length}</span>/200</h2>
        <div className="instance-tools">
          <button disabled={busy || !history.past.length} onClick={() => applyHistory(undoScene(currentHistory.current))}>실행 취소</button>
          <button disabled={busy || !history.future.length} onClick={() => applyHistory(redoScene(currentHistory.current))}>다시 실행</button>
          <button disabled={busy || !referencedAssetsForCurrent.length} onClick={clearScene}>배치·이력 비우기</button>
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
      {!!photos.length && <section className="photo-list" aria-label="사진 목록">
        <h2>사진 {photoIndex + 1} / {photos.length}</h2>
        <div className="photo-navigation">
          <button disabled={busy || photoIndex <= 0} onClick={() => requestPhoto(photos[photoIndex - 1].id)}>이전 사진</button>
          <button disabled={busy || photoIndex >= photos.length - 1} onClick={() => requestPhoto(photos[photoIndex + 1].id)}>다음 사진</button>
        </div>
        {photos.map((item, index) => {
          const session = sessions.current.get(item.id)!
          return <button key={item.id} className="photo-item" disabled={busy} aria-label={`사진 ${index + 1}: ${item.name}`} aria-pressed={photo?.id === item.id} onClick={() => requestPhoto(item.id)}>
            <img src={item.thumbnail} alt="" width="80" height="60" loading="lazy" />
            <span>{index + 1}. {item.name}</span>
            <small>{session.dirty ? (session.saved ? '저장 후 수정' : '수정됨') : session.saved ? (session.outputKey !== outputKey(output) ? '출력 설정 변경' : session.savedFolder !== outputFolder ? '출력 폴더 변경' : '저장 완료') : '미작업'}</small>
          </button>
        })}
      </section>}
    <footer><p role="status" aria-live="polite">{status}</p>{error && !libraryOpen && !pendingPhoto && <p role="alert">{error}</p>}<small>원본은 바꾸지 않습니다. 새 JPG/PNG 파일로 저장합니다. 사진별 편집은 앱을 닫으면 사라집니다. 저장한 결과와 스티커 라이브러리는 유지됩니다.</small></footer>
  </main>
}
createRoot(document.getElementById('root')!).render(<App />)
