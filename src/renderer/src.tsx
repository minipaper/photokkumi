import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type DragEvent } from 'react'
import { createRoot } from 'react-dom/client'
import type { BlurRegion, ImageAsset, PhotoApi, PhotoInfo, Placement, RegionStyle } from '../shared/model'
import { validPlacement } from '../shared/model'
import type { LibrarySticker, StickerMetadata } from '../shared/library'
import { LibraryPanel } from './LibraryPanel'
import { EditorCanvas } from './EditorCanvas'
import { GifMaker } from './GifMaker'
import type { VideoRef } from '../shared/gif'
import { addInstance, addRegion, setAdjustments, updateSelectedRegion, validStrength, updateSelected, removeSelected, duplicateSelected, reorderSelected, emptyHistory, commitScene, undoScene, redoScene, MAX_INSTANCES, MAX_DECODED_STICKER_PIXELS, type Scene, type SceneHistory } from '../shared/scene'
import { createPhotoSession, editPhotoSession, savePhotoSession, discardPhotoSession, sessionAssets, type PhotoSession } from '../shared/photo-session'
import { DEFAULT_OUTPUT, validOutput, outputSize, outputKey, type OutputSettings } from '../shared/output'
import { composePng } from './export'
import { ADJUSTMENT_KEYS, isNeutral, sameAdjustments, NEUTRAL_ADJUSTMENTS, type Adjustments } from '../shared/filters'
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
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsAnchor = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<false | 'photos' | 'stickers'>(false)
  // Numeric position fields stay folded until wanted; the choice is a per-viewer convenience.
  const [fieldsOpen, setFieldsOpen] = useState(() => { try { return localStorage.getItem('pk.placementFields') === 'open' } catch { return false } })
  const toggleFields = () => setFieldsOpen(open => { try { localStorage.setItem('pk.placementFields', open ? 'closed' : 'open') } catch { /* storage unavailable */ } return !open })
  const dragDepth = useRef(0)
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
  const region = scene.regions.find(item => item.id === scene.selectedId) ?? null
  const selection: Placement | null = placement ?? region
  const [drawMode, setDrawMode] = useState(false)
  const [regionDefaults, setRegionDefaults] = useState<Pick<BlurRegion, 'style' | 'strength'>>({ style: 'blur', strength: 50 })
  const liveBase = useRef<Scene | null>(null)
  const [sideTab, setSideTab] = useState<'stickers' | 'adjust'>('stickers')
  const [mode, setMode] = useState<'photo' | 'gif'>('photo')
  const [incomingVideo, setIncomingVideo] = useState<{ ref: VideoRef; nonce: number } | null>(null)
  const [gifBusy, setGifBusy] = useState(false)
  const showError = useCallback((text: string) => setError(text), [])
  const showStatus = useCallback((text: string) => setStatus(text), [])
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
  useEffect(() => {
    if (!settingsOpen) return
    const close = (event: PointerEvent) => { if (!settingsAnchor.current?.contains(event.target as Node)) setSettingsOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [settingsOpen])
  useEffect(() => { if (libraryOpen && !libraryDialog.current?.open) libraryDialog.current?.showModal() }, [libraryOpen])
  const closeLibrary = () => { if (!operation.current) { libraryDialog.current?.close(); setLibraryOpen(false) } }
  useEffect(() => () => photo?.bitmap.close(), [photo])
  useEffect(() => {
    const keep = new Set([...sessions.current.values()].flatMap(sessionAssets))
    for (const [id, asset] of assets.current) if (!keep.has(id)) { asset.bitmap.close(); assets.current.delete(id) }
  }, [history, photo, dirty, photos])
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
    setDirty(true); setStatus('')
    void syncReferences().catch(value => setError(String(value)))
  }
  function editScene(next: Scene) { liveBase.current = null; applyHistory(commitScene(currentHistory.current, next)) }
  /** Slider drags preview without history entries; commitLive turns the whole drag into one undo step. */
  function liveEdit(next: Scene) {
    if (!activeId.current) return
    liveBase.current ??= currentHistory.current.present
    const history = { ...currentHistory.current, present: next }
    sessions.current.set(activeId.current, editPhotoSession(sessions.current.get(activeId.current)!, history))
    currentHistory.current = history; setHistory(history); setDirty(true)
  }
  function commitLive() {
    const base = liveBase.current
    if (!base) return
    liveBase.current = null
    applyHistory(commitScene({ ...currentHistory.current, present: base }, currentHistory.current.present))
  }
  function changeRegionEffect(effect: Pick<BlurRegion, 'style' | 'strength'>, live = false) {
    if (!validStrength(effect.strength)) return
    setRegionDefaults(effect)
    const current = currentHistory.current.present
    if (!current.regions.some(item => item.id === current.selectedId)) return
    const next = updateSelectedRegion(current, effect)
    if (live) liveEdit(next); else editScene(next)
  }
  function changeAdjust(key: keyof Adjustments, value: number, live = false) {
    if (!photo || !Number.isInteger(value) || Math.abs(value) > 100) return
    const current = currentHistory.current.present
    if (current.adjust[key] === value) return
    const next = setAdjustments(current, { ...current.adjust, [key]: value })
    if (live) liveEdit(next); else editScene(next)
  }
  function resetAdjust() { if (photo && !isNeutral(currentHistory.current.present.adjust)) editScene(setAdjustments(currentHistory.current.present, NEUTRAL_ADJUSTMENTS)) }
  function applyAdjustToAll() {
    commitLive()
    const adjust = currentHistory.current.present.adjust
    let count = 0
    for (const item of photos) {
      const session = sessions.current.get(item.id)
      if (!session || item.id === activeId.current || sameAdjustments(session.history.present.adjust, adjust)) continue
      sessions.current.set(item.id, editPhotoSession(session, commitScene(session.history, setAdjustments(session.history.present, adjust))))
      count++
    }
    setStatus(count ? `보정 값을 다른 사진 ${count}장에 적용했습니다. 사진마다 실행 취소할 수 있습니다.` : '다른 사진에 이미 같은 보정이 적용되어 있습니다.')
  }
  function drawRegion(value: Placement) {
    setDrawMode(false); setSideTab('stickers')
    if (!photo) return
    try {
      editScene(addRegion(currentHistory.current.present, { id: crypto.randomUUID(), ...value, ...regionDefaults }))
      setStatus('가림 영역을 만들었습니다. 드래그로 이동하고 핸들로 크기·회전을 조절하세요.')
    } catch (value) { setError(value instanceof Error ? value.message : '영역을 만들 수 없습니다.') }
  }
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
  const importDroppedStickers = (files: File[]) => run(async () => {
    const result = await window.photokkumi.importDroppedStickers(files)
    if (!result.ok) throw new Error(result.error)
    const { stickers, importedIds, rejected } = result.value
    setLibraryItems(stickers)
    setStatus(`스티커 ${importedIds.length}개를 등록했습니다. 같은 PNG는 중복 등록하지 않습니다.${rejected.length ? ` PNG가 아닌 항목 ${rejected.length}개 제외: ${rejected.slice(0, 3).join(', ')}${rejected.length > 3 ? ' 외' : ''}` : ''}`)
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
    setDrawMode(false)
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
  function change(value: Placement, id = selection ? scene.selectedId ?? undefined : undefined) {
    if (!id || !validPlacement(value)) return
    const current = currentHistory.current.present
    editScene(updateSelected({ ...current, selectedId: id }, value))
  }
  function handleEditorKey(event: KeyboardEvent<HTMLElement>) {
    const target = event.target
    if (mode !== 'photo') return
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.altKey
      || operation.current || closeRequest || pendingPhoto || libraryOpen || (target instanceof HTMLElement
        && (target.isContentEditable || target.closest('input, textarea, select, dialog, [role="textbox"]')))) return
    if (event.key === 'Escape' && drawMode) { event.preventDefault(); setDrawMode(false); return }
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
    const selected = [...current.stickers, ...current.regions].find(item => item.id === current.selectedId)
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
    currentHistory.current = session.history; setHistory(session.history); liveBase.current = null
    setPhoto(decoded); setDirty(session.dirty); setDrawMode(false)
    setStatus(`${decoded.name} · 편집 중`)
  }
  const choosePhoto = () => run(async () => {
    const result = await window.photokkumi.choosePhotos()
    if (!result.ok) throw new Error(result.error)
    if (result.value) await acceptBatch(result.value, [])
  })
  async function acceptBatch(imported: PhotoInfo[], rejected: string[]) {
    const added = imported.filter(item => !sessions.current.has(item.id)).length
    for (const item of imported) if (!sessions.current.has(item.id)) sessions.current.set(item.id, createPhotoSession())
    setPhotos(imported)
    if (!activeId.current && imported[0]) await activatePhoto(imported[0].id)
    setStatus(`사진 ${added}장 추가 · 전체 ${imported.length}장.${rejected.length ? ` 지원하지 않거나 읽을 수 없는 파일 ${rejected.length}개 제외: ${rejected.slice(0, 3).join(', ')}${rejected.length > 3 ? ' 외' : ''}` : ''}`)
  }
  const choosePhotoFolder = () => run(async () => {
    const result = await window.photokkumi.choosePhotoFolder()
    if (!result.ok) throw new Error(result.error)
    if (result.value) await acceptBatch(result.value.photos, result.value.rejected)
  })
  const importDropped = (files: File[]) => run(async () => {
    const result = await window.photokkumi.importDroppedFiles(files)
    if (!result.ok) throw new Error(result.error)
    const { photos: imported, rejected, videos } = result.value
    const before = photos.length
    await acceptBatch(imported, rejected)
    // A dropped video opens the GIF maker; photos-only drops bring the editor forward.
    if (videos[0]) { setMode('gif'); setIncomingVideo({ ref: videos[0], nonce: Date.now() }) }
    else if (imported.length !== before || !rejected.length) setMode('photo')
  })
  const removePhoto = (id: string) => run(async () => {
    const index = photos.findIndex(item => item.id === id)
    const target = photos[index], session = sessions.current.get(id)
    if (!target || !session) return
    if (session.dirty && !window.confirm(`${target.name}의 저장하지 않은 편집이 사라집니다. 목록에서 제거할까요?`)) return
    if (activeId.current === id) {
      const neighbor = photos[index + 1] ?? photos[index - 1]
      if (neighbor) await activatePhoto(neighbor.id)
    }
    const result = await window.photokkumi.removePhoto(id)
    if (!result.ok) throw new Error(result.error)
    sessions.current.delete(id)
    if (activeId.current === id) {
      activeId.current = null
      const next = emptyHistory()
      currentHistory.current = next; setHistory(next); setPhoto(null); setDirty(false)
    }
    setPhotos(result.value)
    setStatus(`${target.name}을(를) 목록에서 제거했습니다. 원본 파일은 그대로입니다.`)
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
    const png = await composePng(photo.bitmap, currentHistory.current.present.stickers, assets.current, output, currentHistory.current.present.regions, currentHistory.current.present.adjust)
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
  const outputSummary = `${output.format === 'jpg' ? 'JPG' : 'PNG'} · ${output.resizeEnabled ? `${output.resizeBasis === 'width' ? '가로' : '긴 축'} ${output.landscapeSize}/${output.portraitSize}px` : '원본 크기'}`
  const photoState = (session: PhotoSession) => session.dirty ? (session.saved ? '저장 후 수정' : '수정됨') : session.saved ? (session.outputKey !== outputKey(output) ? '출력 설정 변경' : session.savedFolder !== outputFolder ? '출력 폴더 변경' : '저장 완료') : '미작업'
  const canSave = !busy && !!photo && outputLoaded && !outputError
  const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes('Files')
  const dropBlocked = busy || gifBusy || !!pendingPhoto || !!closeRequest || libraryOpen
  // Files dropped on the sticker library register as stickers; anywhere else they open as photos/videos.
  const dropZone = (event: DragEvent): 'photos' | 'stickers' => mode === 'photo' && sideTab === 'stickers' && (event.target as Element).closest?.('.library-pane') ? 'stickers' : 'photos'
  const editTools = selection ? <>
    <button className="icon" aria-label="선택 복제" title="복제 (Ctrl+D)" onClick={duplicate}><svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 3.5v-.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.5"/></svg></button>
    {placement && <>
      <button className="icon" aria-label="위로" title="한 단계 위로 (다른 스티커 위에 겹치기)" disabled={placement.zOrder === scene.stickers.length - 1} onClick={() => editScene(reorderSelected(currentHistory.current.present, 1))}><svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="6.5" width="7" height="7" rx="1" strokeDasharray="2 1.6"/><rect x="6.5" y="2.5" width="7" height="7" rx="1" fill="currentColor" fillOpacity=".25"/></svg></button>
      <button className="icon" aria-label="아래로" title="한 단계 아래로 (다른 스티커 밑으로)" disabled={placement.zOrder === 0} onClick={() => editScene(reorderSelected(currentHistory.current.present, -1))}><svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="6.5" y="2.5" width="7" height="7" rx="1"/><rect x="2.5" y="6.5" width="7" height="7" rx="1" fill="currentColor" fillOpacity=".25" strokeDasharray="2 1.6"/></svg></button>
    </>}
    <button className="icon danger" aria-label="선택 삭제" title="삭제 (Delete)" onClick={() => editScene(removeSelected(currentHistory.current.present))}><svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 4.5h11M6.5 4.5V3a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v1.5M4 4.5l.7 8.6a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.7-8.6"/></svg></button>
  </> : null
  return <main onKeyDown={handleEditorKey}
    onDragEnter={event => { if (!hasFiles(event)) return; event.preventDefault(); dragDepth.current++; setDragging(dropZone(event)) }}
    onDragOver={event => { if (!hasFiles(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = dropBlocked ? 'none' : 'copy'; const zone = dropZone(event); if (dragging !== zone) setDragging(zone) }}
    onDragLeave={event => { if (!hasFiles(event)) return; dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false) }}
    onDrop={event => {
      if (!hasFiles(event)) return
      event.preventDefault(); dragDepth.current = 0; setDragging(false)
      if (dropBlocked) { setStatus('진행 중인 작업이나 열린 창을 닫은 뒤 다시 끌어 놓으세요.'); return }
      const files = Array.from(event.dataTransfer.files)
      if (files.length) void (dropZone(event) === 'stickers' ? importDroppedStickers(files) : importDropped(files))
    }}>
    {dragging && <div className={`drop-overlay ${dragging}`} aria-hidden="true">{dragging === 'stickers'
      ? <div><strong>놓으면 스티커로 등록합니다</strong><span>투명 배경 PNG 파일</span></div>
      : <div><strong>여기에 놓으면 불러옵니다</strong><span>JPG·PNG 사진, 사진이 든 폴더, MOV·MP4 동영상 · 스티커 목록 위에 놓으면 스티커로 등록</span></div>}</div>}
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
    <header className="toolbar">
      <h1>포토꾸미</h1>
      <div className="mode-tabs" role="tablist" aria-label="작업 모드">
        <button role="tab" aria-selected={mode === 'photo'} disabled={gifBusy} onClick={() => setMode('photo')}>사진 편집</button>
        <button role="tab" aria-selected={mode === 'gif'} disabled={busy} onClick={() => { setDrawMode(false); setSettingsOpen(false); setMode('gif') }}>GIF 만들기</button>
      </div>
      <div className="photo-tools" hidden={mode !== 'photo'}>
      <nav aria-label="파일 작업" className="toolbar-group">
        <button onClick={choosePhoto} disabled={busy || !!pendingPhoto}>사진 열기</button>
        <button onClick={choosePhotoFolder} disabled={busy || !!pendingPhoto}>폴더 열기</button>
      </nav>
      <div className="toolbar-group" aria-label="편집 이력">
        <button className="icon" aria-label="실행 취소" title="실행 취소 (Ctrl+Z)" disabled={busy || !history.past.length} onClick={() => applyHistory(undoScene(currentHistory.current))}><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5.5 3.5 2.5 6.5l3 3"/><path d="M2.5 6.5h7a4 4 0 0 1 0 8H7"/></svg></button>
        <button className="icon" aria-label="다시 실행" title="다시 실행 (Ctrl+Shift+Z)" disabled={busy || !history.future.length} onClick={() => applyHistory(redoScene(currentHistory.current))}><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="m10.5 3.5 3 3-3 3"/><path d="M13.5 6.5h-7a4 4 0 0 0 0 8H9"/></svg></button>
      </div>
      <div className="toolbar-group">
        <button className="draw-toggle" aria-label="블러·모자이크" aria-pressed={drawMode} disabled={busy || !photo} title="블러·모자이크 영역 그리기 — 드래그, Shift: 정원, 클릭: 기본 원, Esc: 취소" onClick={() => { setDrawMode(mode => !mode); setSideTab('stickers') }}>
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.4 1.8"><ellipse cx="8" cy="8" rx="6.5" ry="5.5" /></svg><span className="label"> 블러·모자이크</span><span className="label-short"> 블러</span>
        </button>
      </div>
      <div className="toolbar-spacer" />
      <div className="settings-anchor" ref={settingsAnchor}>
        <button className={`settings-toggle${outputError ? ' invalid' : ''}`} aria-expanded={settingsOpen} aria-controls="output-settings" onClick={() => setSettingsOpen(open => !open)}>
          저장 설정 <span className="summary">{outputSummary}</span> ▾
        </button>
        <div id="output-settings" className="settings-popover" hidden={!settingsOpen} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setSettingsOpen(false) } }}>
          <div className="settings-row folder">
            <span>출력 폴더</span>
            <span className="folder-name" data-testid="output-folder" title={outputFolder ?? undefined}>{outputFolder ?? '미지정 · 첫 저장 시 선택'}</span>
            <button onClick={chooseOutputFolder} disabled={busy}>출력 폴더 선택</button>
          </div>
          <fieldset className="output-settings" disabled={busy || !outputLoaded} aria-label="출력 설정">
            <label>형식<select aria-label="출력 형식" value={output.format} onChange={e => setOutput({ ...output, format: e.target.value as 'png' | 'jpg' })}>
              <option value="png">PNG</option><option value="jpg">JPG</option>
            </select></label>
            <label>JPG 품질<input aria-label="JPG 품질" type="number" min="100" max="100" step="1" disabled value={Number.isFinite(output.quality) ? output.quality : ''} readOnly /></label>
            <label className="check"><input type="checkbox" checked={output.resizeEnabled} onChange={e => setOutput({ ...output, resizeEnabled: e.target.checked })} />블로그 크기로 리사이즈</label>
            <label>기준<select aria-label="리사이즈 기준" disabled={!output.resizeEnabled} value={output.resizeBasis} onChange={e => setOutput({ ...output, resizeBasis: e.target.value as 'width' | 'longEdge' })}>
              <option value="width">가로 너비</option><option value="longEdge">긴 축</option>
            </select></label>
            <label>가로 사진<span><input aria-label="가로 사진 길이" type="number" min="1" max="8192" disabled={!output.resizeEnabled} value={Number.isFinite(output.landscapeSize) ? output.landscapeSize : ''} onChange={e => setOutput({ ...output, landscapeSize: e.target.valueAsNumber })} /> px</span></label>
            <label>세로 사진<span><input aria-label="세로 사진 길이" type="number" min="1" max="8192" disabled={!output.resizeEnabled} value={Number.isFinite(output.portraitSize) ? output.portraitSize : ''} onChange={e => setOutput({ ...output, portraitSize: e.target.valueAsNumber })} /> px</span></label>
            <label className="check"><input type="checkbox" checked={output.preventUpscale} onChange={e => setOutput({ ...output, preventUpscale: e.target.checked })} />확대 방지</label>
            <div className="settings-result">결과 크기 <strong data-testid="output-size">{outputLabel}</strong></div>
            {outputError && <p role="alert">{outputError}</p>}
          </fieldset>
        </div>
      </div>
      <button onClick={save} disabled={!canSave}>{busy ? '처리 중…' : output.format === 'jpg' ? 'JPG로 저장' : 'PNG로 저장'}</button>
      <button className="primary" onClick={saveNext} disabled={!canSave}>저장하고 다음</button>
      </div>
    </header>
    <div className="gif-host" hidden={mode !== 'gif'}>
      <GifMaker incoming={incomingVideo} outputFolder={outputFolder} active={mode === 'gif'} onBusyChange={setGifBusy}
        onSaved={receipt => setOutputFolder(receipt.folderLabel)} onStatus={showStatus} onError={showError} />
    </div>
    <section className="workspace" hidden={mode !== 'photo'}>
      <div className="canvas-column">
        {photo ? <EditorCanvas key={photo.id} photo={photo} assets={assets.current} scene={scene} disabled={busy} onSelect={selectInstance} onChange={(id, value) => change(value, id)} selectionTools={editTools}
          drawMode={drawMode} onDraw={drawRegion}
          info={<>{photo.name} · {photo.width} × {photo.height} px{outputLabel && outputLabel !== `${photo.width} × ${photo.height} px` ? ` → ${outputLabel}` : ''} · <b className={dirty ? 'dirty' : ''}>{dirty ? '수정됨' : '원본 / 저장됨'}</b></>} />
          : <div className="empty"><div className="drop-target"><strong>사진을 이 창으로 끌어다 놓으세요</strong><span>탐색기에서 JPG·PNG 사진 여러 장이나 폴더를 한 번에 끌어 놓으면 바로 불러옵니다.</span><span>또는 위의 <b>사진 열기</b> · <b>폴더 열기</b></span></div></div>}
      </div>
      <aside>
        <div className="side-tabs" role="tablist" aria-label="편집 패널">
          <button role="tab" aria-selected={sideTab === 'stickers'} onClick={() => setSideTab('stickers')}>스티커</button>
          <button role="tab" aria-selected={sideTab === 'adjust'} onClick={() => { setDrawMode(false); setSideTab('adjust') }}>보정{!isNeutral(scene.adjust) && <span className="tab-dot" aria-label="(적용됨)" />}</button>
        </div>
        {sideTab === 'adjust' ? <section className="adjust-panel" aria-label="사진 보정">
          {ADJUSTMENT_KEYS.map(key => {
            const label = { exposure: '노출', contrast: '대비', saturation: '채도', temperature: '색온도' }[key]
            return <div key={key} className={`adjust-row ${key}`}>
              <div className="adjust-head"><span>{label}</span>
                <input type="number" aria-label={label} min="-100" max="100" step="1" disabled={busy || !photo} value={scene.adjust[key]}
                  onChange={e => changeAdjust(key, e.target.valueAsNumber)} /></div>
              <input type="range" aria-label={`${label} 슬라이더`} min="-100" max="100" step="1" disabled={busy || !photo} value={scene.adjust[key]}
                title="두 번 클릭하면 0으로" onDoubleClick={() => changeAdjust(key, 0)}
                onChange={e => changeAdjust(key, e.target.valueAsNumber, true)} onPointerUp={commitLive} onKeyUp={commitLive} onBlur={commitLive} />
            </div>
          })}
          <div className="adjust-actions">
            <button disabled={busy || !photo || isNeutral(scene.adjust)} onClick={resetAdjust}>초기화</button>
            <button disabled={busy || !photo || photos.length < 2} onClick={applyAdjustToAll}>모든 사진에 적용</button>
          </div>
          <p className="hint">{photo ? '보정은 사진에만 적용되고 스티커에는 적용되지 않습니다. 슬라이더를 두 번 클릭하면 0으로 돌아갑니다.' : '사진을 열면 노출·대비·채도·색온도를 조절할 수 있습니다.'}</p>
        </section> : <>
        <div className={`library-pane${dragging === 'stickers' ? ' drop-here' : ''}`} hidden={libraryOpen}><LibraryPanel {...libraryProps} mode="pick" onManage={() => setLibraryOpen(true)} /></div>
        {photo && <section className="placed" aria-label="올린 항목">
          <div className="pane-heading">
            <h2>올린 항목 <small>스티커 <span data-testid="instance-count">{scene.stickers.length}</span>{!!scene.regions.length && <> · 가림 <span data-testid="region-count">{scene.regions.length}</span></>}</small></h2>
            <button className="link" disabled={busy || !(referencedAssetsForCurrent.length || scene.regions.length || history.past.length || history.future.length)} onClick={clearScene}>배치·이력 비우기</button>
          </div>
          {!!(scene.stickers.length || scene.regions.length) && <div className="instance-list" aria-label="사진의 스티커 목록">
            {scene.regions.map((item, index) => <button key={item.id} className="region-chip" disabled={busy}
              aria-label={`가림 ${index + 1}: ${item.style === 'blur' ? '블러' : '모자이크'}`} aria-pressed={scene.selectedId === item.id}
              onClick={() => selectInstance(item.id)}>◌ {item.style === 'blur' ? '블러' : '모자이크'} {index + 1}</button>)}
            {scene.stickers.map((item, index) => <button key={item.id} disabled={busy}
              aria-label={`배치 ${index + 1}: ${assets.current.get(item.assetId)?.name ?? '스티커'}`} aria-pressed={scene.selectedId === item.id}
              onClick={() => selectInstance(item.id)}>{index + 1}. {assets.current.get(item.assetId)?.name ?? '스티커'}</button>)}
          </div>}
          {(region || drawMode) && <div className="region-fields" role="group" aria-label="가림 효과">
            <div className="segmented" role="radiogroup" aria-label="가림 방식">
              {(['blur', 'mosaic'] as RegionStyle[]).map(style => <button key={style} role="radio" aria-checked={(region ?? regionDefaults).style === style} disabled={busy}
                onClick={() => changeRegionEffect({ style, strength: (region ?? regionDefaults).strength })}>{style === 'blur' ? '블러' : '모자이크'}</button>)}
            </div>
            <label>강도
              <input type="range" aria-label="가림 강도 슬라이더" min="1" max="100" step="1" disabled={busy} value={(region ?? regionDefaults).strength}
                onChange={e => changeRegionEffect({ style: (region ?? regionDefaults).style, strength: e.target.valueAsNumber }, true)}
                onPointerUp={commitLive} onKeyUp={commitLive} onBlur={commitLive} />
              <input type="number" aria-label="가림 강도" min="1" max="100" step="1" disabled={busy} value={(region ?? regionDefaults).strength}
                onChange={e => changeRegionEffect({ style: (region ?? regionDefaults).style, strength: e.target.valueAsNumber })} />
            </label>
            {drawMode && !region && <p className="hint">사진 위를 드래그해 영역을 그리세요. Shift는 정원, 클릭만 하면 기본 원, Esc는 취소입니다.</p>}
          </div>}
          {selection ? <div className="placement-detail">
            <button className="disclosure" aria-expanded={fieldsOpen} onClick={toggleFields}><span className="chevron" aria-hidden="true">▸</span>위치·크기 숫자로 조정</button>
            {fieldsOpen && <fieldset className="placement-fields" disabled={busy} title="원본 픽셀 기준">
              <label>X<input aria-label="중심 X" type="number" value={Math.round(selection.x)} onChange={e => change({ ...selection, x: e.target.valueAsNumber })} /></label>
              <label>Y<input aria-label="중심 Y" type="number" value={Math.round(selection.y)} onChange={e => change({ ...selection, y: e.target.valueAsNumber })} /></label>
              {region ? <>
                <label>너비<input aria-label="영역 너비" type="number" min="1" max="32768" value={Math.round(region.width)} onChange={e => change({ ...region, width: e.target.valueAsNumber })} /></label>
                <label>높이<input aria-label="영역 높이" type="number" min="1" max="32768" value={Math.round(region.height)} onChange={e => change({ ...region, height: e.target.valueAsNumber })} /></label>
              </> : <label>너비<input aria-label="스티커 너비" type="number" min="1" max="32768" value={Math.round(selection.width)} onChange={e => change({ ...selection, width: e.target.valueAsNumber, height: e.target.valueAsNumber * selection.height / selection.width })} /></label>}
              <label>회전<input aria-label="회전" type="number" value={Math.round(selection.rotation)} onChange={e => change({ ...selection, rotation: e.target.valueAsNumber })} /></label>
            </fieldset>}
          </div> : drawMode ? null : <p className="hint">스티커를 클릭하면 사진 위에 복제·순서·삭제 버튼이 나타납니다. 방향키 1px, Shift+방향키 10px 이동.</p>}
        </section>}
        </>}
      </aside>
    </section>
    {!!photos.length && mode === 'photo' && <section className="photo-list" aria-label="사진 목록">
      <div className="photo-nav">
        <button className="icon nav" aria-label="이전 사진" disabled={busy || photoIndex <= 0} onClick={() => requestPhoto(photos[photoIndex - 1].id)}>‹</button>
        <h2>{photoIndex + 1} / {photos.length}</h2>
        <button className="icon nav" aria-label="다음 사진" disabled={busy || photoIndex >= photos.length - 1} onClick={() => requestPhoto(photos[photoIndex + 1].id)}>›</button>
      </div>
      <div className="photo-strip">
        {photos.map((item, index) => {
          const session = sessions.current.get(item.id)!
          const state = photoState(session)
          return <div key={item.id} className="photo-cell">
            <button className="photo-item" data-state={state} disabled={busy} aria-label={`사진 ${index + 1}: ${item.name}`} aria-pressed={photo?.id === item.id} onClick={() => requestPhoto(item.id)} title={`${item.name} · ${state}`}>
              <img src={item.thumbnail} alt="" width="80" height="60" loading="lazy" />
              <span>{index + 1}. {item.name}</span>
              <small>{state}</small>
            </button>
            <button className="photo-remove" disabled={busy || !!pendingPhoto} aria-label={`${item.name} 목록에서 제거`} title="목록에서 제거 (원본 파일은 유지)" onClick={() => removePhoto(item.id)}>×</button>
          </div>
        })}
      </div>
    </section>}
    <footer className="statusbar"><p role="status" aria-live="polite">{status || (mode === 'photo' && photo ? <span className="shortcuts">Ctrl+Z 실행 취소 · Ctrl+D 복제 · Delete 삭제 · 방향키 이동 · Ctrl+휠 확대</span> : '')}</p>{error && !libraryOpen && !pendingPhoto && <p role="alert">{error}</p>}</footer>
  </main>
}
createRoot(document.getElementById('root')!).render(<App />)
