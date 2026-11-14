import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type DragEvent } from 'react'
import { createRoot } from 'react-dom/client'
import type { ImageAsset, PhotoApi, PhotoInfo, Placement, RegionShape, RegionStyle } from '../shared/model'
import { validPlacement } from '../shared/model'
import type { LibrarySticker, StickerMetadata } from '../shared/library'
import { LibraryPanel } from './LibraryPanel'
import { EditorCanvas } from './EditorCanvas'
import { GifMaker } from './GifMaker'
import type { VideoRef } from '../shared/gif'
import type { UpdateState } from '../shared/update'
import { loadPref, savePref } from './remember'
import { TextPanel } from './TextPanel'
import { BackgroundPanel, ShapePanel, TemplateGallery, validMyTemplates, MAX_MY_TEMPLATES, type MyTemplate, type ShapePreset, type TemplateFilter } from './ThumbPanel'
import { drawLayout, layoutTemplate, renderBackground, type ThumbLayout } from './thumb'
import { THUMB_TEMPLATES, templateById, templateColors, type ThumbTemplate } from '../shared/thumb-templates'
import { DEFAULT_BACKGROUND, SHAPE_STYLE_KEYS, THUMB_SESSION_ID, THUMB_SIZE, palette, validBackground, type ShapeItem, type ShapeStyle, type ThumbBackground } from '../shared/shapes'
import { ensureFont, ensureTextFonts, listSystemFonts, withMeasuredSize } from './text'
import { DEFAULT_TEXT, DEFAULT_TEXT_STYLE, MAX_MY_PRESETS, MAX_TEXTS, samePreset, validFontSize, validMyPresets, validRelSize, validTextStyle, type MyPreset, type TextItem, type TextStyle } from '../shared/text'
const validRegionEffect = (value: unknown): value is { style: 'blur' | 'mosaic'; strength: number; shape: 'ellipse' | 'rect' } => {
  const v = value as Record<string, unknown> | null
  return !!v && typeof v === 'object' && ['blur', 'mosaic'].includes(v.style as string) && typeof v.strength === 'number' && validStrength(v.strength) && ['ellipse', 'rect'].includes(v.shape as string)
}
import { addInstance, addRegion, addShape, addText, applyLayout, applyTheme, setBackground, updateSelectedShape, clearRegions, clearTexts, updateSelectedText, setAdjustments, updateSelectedRegion, validStrength, updateSelected, removeSelected, duplicateSelected, reorderSelected, emptyHistory, commitScene, undoScene, redoScene, MAX_INSTANCES, MAX_DECODED_STICKER_PIXELS, type Scene, type SceneHistory } from '../shared/scene'
import { createPhotoSession, editPhotoSession, savePhotoSession, discardPhotoSession, sessionAssets, type PhotoSession } from '../shared/photo-session'
import { DEFAULT_OUTPUT, validOutput, outputSize, outputKey, type OutputSettings } from '../shared/output'
import { composePng } from './export'
import { ADJUSTMENT_KEYS, isNeutral, sameAdjustments, NEUTRAL_ADJUSTMENTS, type Adjustments } from '../shared/filters'
import { CROP_LABELS, CROP_PRESETS, aspectRatio, centeredCrop, cropArea, fullCrop, hasOrientation, isPortraitAspect, moveCrop, normalizeCrop, orient, sameCrop, type Crop, type CropAspect, type CropRect } from '../shared/crop'
import './style.css'
const validTextDefaults = (value: unknown): value is { style: TextStyle; relSize: number } => {
  const v = value as Record<string, unknown> | null
  return !!v && typeof v === 'object' && validTextStyle(v.style) && validRelSize(v.relSize)
}
/** Which side tab edits the selected item. */
function selectedKind(scene: Scene): 'stickers' | 'regions' | 'text' | 'shapes' | null {
  const id = scene.selectedId
  if (!id) return null
  return scene.texts.some(item => item.id === id) ? 'text' : scene.shapes.some(item => item.id === id) ? 'shapes' : scene.regions.some(item => item.id === id) ? 'regions' : scene.stickers.some(item => item.id === id) ? 'stickers' : null
}

declare global { interface Window { photokkumi: PhotoApi } }
const THUMB = THUMB_SESSION_ID
const blobUrl = (blob: Blob) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.onerror = () => reject(new Error('미리보기를 만들 수 없습니다.')); reader.readAsDataURL(blob) })
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
  const [update, setUpdate] = useState<UpdateState | null>(null)
  const [dismissedUpdate, setDismissedUpdate] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void window.photokkumi.getUpdateState().then(result => { if (alive && result.ok) setUpdate(result.value) })
    const off = window.photokkumi.onUpdateState(state => setUpdate(state))
    return () => { alive = false; off() }
  }, [])
  // HEIC photos take about a second each to convert, so a batch reports how far it got.
  useEffect(() => window.photokkumi.onPhotoProgress((done, total) => setStatus(`사진 불러오는 중… ${done}/${total}`)), [])
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
  const [photo, setPhotoState] = useState<DecodedAsset | null>(null)
  // The shown photo also in a ref: a save right after switching back from the thumbnail must not see the old render's value.
  const livePhoto = useRef<DecodedAsset | null>(null)
  const setPhoto = (next: DecodedAsset | null) => { livePhoto.current = next; setPhotoState(next) }
  const [history, setHistory] = useState<SceneHistory>(emptyHistory)
  const currentHistory = useRef(history)
  const assets = useRef(new Map<string, DecodedAsset>())
  const scene = history.present
  const placement = scene.stickers.find(item => item.id === scene.selectedId) ?? null
  const region = scene.regions.find(item => item.id === scene.selectedId) ?? null
  const textItem = scene.texts.find(item => item.id === scene.selectedId) ?? null
  const shapeItem = scene.shapes.find(item => item.id === scene.selectedId) ?? null
  const selection: Placement | null = placement ?? region ?? textItem ?? shapeItem
  type RegionEffect = { style: RegionStyle; strength: number; shape: RegionShape }
  const [regionDefaults, setRegionDefaults] = useState<RegionEffect>(() => loadPref('pk.regionDefaults', { style: 'blur', strength: 50, shape: 'ellipse' }, validRegionEffect))
  const liveBase = useRef<Scene | null>(null)
  type SideTab = 'stickers' | 'regions' | 'adjust' | 'text' | 'crop'
  const [sideTab, setSideTab] = useState<SideTab>('stickers')
  // Look of the next text; relSize is the font size relative to the photo's short edge so captions match across photos.
  type TextDefaults = { style: TextStyle; relSize: number }
  const [textDefaults, setTextDefaults] = useState<TextDefaults>(() => loadPref('pk.textDefaults', { style: { ...DEFAULT_TEXT_STYLE }, relSize: 0.08 }, validTextDefaults))
  const [systemFonts, setSystemFonts] = useState<string[] | null>(null)
  const [myPresets, setMyPresets] = useState<MyPreset[]>(() => loadPref('pk.textPresets', [], validMyPresets))
  function storeMyPresets(next: MyPreset[]) { setMyPresets(next); savePref('pk.textPresets', next) }
  const textArea = useRef<HTMLTextAreaElement>(null)
  const focusNewText = useRef(false)
  const [mode, setMode] = useState<'photo' | 'gif' | 'thumb'>('photo')
  type ThumbTab = 'template' | 'background' | 'text' | 'deco'
  const [thumbTab, setThumbTab] = useState<ThumbTab>('template')
  const [templateFilter, setTemplateFilter] = useState<TemplateFilter>('all')
  const [thumbFormat, setThumbFormat] = useState<'jpg' | 'png'>(() => loadPref('pk.thumbFormat', 'jpg', (value): value is 'jpg' | 'png' => value === 'jpg' || value === 'png'))
  const [myTemplates, setMyTemplates] = useState<MyTemplate[]>(() => loadPref('pk.thumbTemplates', [], validMyTemplates))
  /** The photo the editor showed before the thumbnail tab opened; it comes back on return. */
  const photoModeId = useRef<string | null>(null)
  /** Decoded background photo of the thumbnail (full size, cover-cropped when drawn). */
  const thumbSource = useRef<{ id: string; bitmap: ImageBitmap } | null>(null)
  const [thumbPhoto, setThumbPhoto] = useState<ImageBitmap | null>(null)
  const textTabOpen = mode === 'thumb' ? thumbTab === 'text' : sideTab === 'text'
  useEffect(() => { if (textTabOpen && systemFonts === null) void listSystemFonts().then(setSystemFonts) }, [textTabOpen, systemFonts])
  // The region tab is the blur/mosaic tool: it stays on until another tab, Esc or the toolbar button.
  const drawMode = sideTab === 'regions' && mode === 'photo' && !!photo
  // The crop tab is the crop tool: the canvas shows the whole photo with the crop box until the tab closes.
  const cropMode = sideTab === 'crop' && mode === 'photo' && !!photo
  /** Crop being edited; it becomes one undo step when the tool closes (완료/Enter, another tab, saving, switching photos). Esc drops it. */
  type CropDraft = { photoId: string; width: number; height: number; crop: Crop }
  const [cropDraft, setCropDraftState] = useState<CropDraft | null>(null)
  const cropDraftRef = useRef<CropDraft | null>(null)
  const setCropDraft = (next: CropDraft | null) => { cropDraftRef.current = next; setCropDraftState(next) }
  /** 가로/세로 choice for ratio presets (4:3 ↔ 3:4). */
  const [cropPortrait, setCropPortrait] = useState(false)
  const [incomingVideo, setIncomingVideo] = useState<{ ref: VideoRef; nonce: number } | null>(null)
  const [gifBusy, setGifBusy] = useState(false)
  const showError = useCallback((text: string) => setError(text), [])
  const showStatus = useCallback((text: string) => setStatus(text), [])
  const activeSession = photo ? sessions.current.get(photo.id) : undefined
  const referencedAssetsForCurrent = activeSession ? sessionAssets(activeSession) : []
  const referencedIds = [...new Set([...sessions.current.values()].flatMap(sessionAssets))]
  const [busy, setBusy] = useState(false)
  // Type right away into a new text: the placeholder is selected so the first keystroke replaces it.
  // Runs once the add operation has finished, because the textarea is disabled while busy.
  useEffect(() => {
    const input = textArea.current
    if (!focusNewText.current || busy || !input || input.disabled) return
    focusNewText.current = false
    input.focus(); input.select()
  }, [busy, history])
  const operation = useRef(false)
  const [status, setStatus] = useState('사진을 열어 시작하세요.')
  const [error, setError] = useState('')
  const [libraryItems, setLibraryItems] = useState<LibrarySticker[]>([])
  const [dirty, setDirty] = useState(false)
  // Edits can wait in both the thumbnail and the editor's photo (switching tabs does not ask to save).
  const cropPending = !!cropDraft && !!photo && cropDraft.photoId === photo.id && !sameCrop(normalizeCrop(cropDraft.crop, cropDraft), scene.crop)
  const anyDirty = dirty || cropPending || [...sessions.current.values()].some(session => session.dirty)
  const [closeRequest, setCloseRequest] = useState<string | null>(null)
  const closeDialog = useRef<HTMLDialogElement>(null)
  useEffect(() => window.photokkumi.onCloseRequested(setCloseRequest), [])
  useEffect(() => {
    if (!closeRequest || busy) return
    switchDialog.current?.close(); setPendingPhoto(null)
    libraryDialog.current?.close(); setLibraryOpen(false)
    if (!anyDirty) {
      void resolveClose('close').catch(value => setError(String(value)))
    } else if (!closeDialog.current?.open) closeDialog.current?.showModal()
  }, [closeRequest, busy, anyDirty])
  useEffect(() => {
    if (!settingsOpen) return
    const close = (event: PointerEvent) => { if (!settingsAnchor.current?.contains(event.target as Node)) setSettingsOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [settingsOpen])
  useEffect(() => { if (libraryOpen && !libraryDialog.current?.open) libraryDialog.current?.showModal() }, [libraryOpen])
  const closeLibrary = () => { if (!operation.current) { libraryDialog.current?.close(); setLibraryOpen(false) } }
  useEffect(() => () => photo?.bitmap.close(), [photo])
  useEffect(() => () => thumbSource.current?.bitmap.close(), [])
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
  function changeRegionEffect(effect: RegionEffect, live = false) {
    if (!validStrength(effect.strength)) return
    setRegionDefaults(effect)
    savePref('pk.regionDefaults', effect)
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
  /** Writes a crop draft into its photo's history (the active photo or one already switched away from). */
  function commitCropDraft(pending: CropDraft) {
    const session = sessions.current.get(pending.photoId)
    if (!session) return
    const crop = normalizeCrop(pending.crop, pending), active = pending.photoId === activeId.current
    const present = active ? currentHistory.current.present : session.history.present
    if (sameCrop(present.crop, crop)) return
    if (active) editScene({ ...present, crop })
    else sessions.current.set(pending.photoId, editPhotoSession(session, commitScene(session.history, { ...present, crop })))
  }
  function commitCrop() { if (cropDraftRef.current) commitCropDraft(cropDraftRef.current) }
  useEffect(() => {
    const pending = cropDraftRef.current
    // Leaving the tool some other way (a toolbar button, another mode or photo) still keeps the crop.
    if (pending && (!cropMode || pending.photoId !== photo?.id)) commitCropDraft(pending)
    if (!cropMode || !photo) { setCropDraft(null); return }
    // Undo/redo or a commit changed the crop: show the photo's crop (an unchanged draft keeps its preset).
    if (pending?.photoId === photo.id && sameCrop(normalizeCrop(pending.crop, pending), scene.crop)) return
    const crop = scene.crop ?? fullCrop(photo)
    setCropDraft({ photoId: photo.id, width: photo.width, height: photo.height, crop })
    setCropPortrait(hasOrientation(crop.aspect) ? isPortraitAspect(crop.aspect) : photo.height > photo.width)
    // commitCropDraft only reads refs and session state.
  }, [cropMode, photo, scene.crop])
  function changeCropRect(rect: CropRect) { const draft = cropDraftRef.current; if (draft) setCropDraft({ ...draft, crop: { ...draft.crop, ...rect } }) }
  function chooseCropAspect(base: CropAspect) {
    const draft = cropDraftRef.current
    if (!draft) return
    const aspect = orient(base, cropPortrait)
    // A ratio starts as the largest centered box; 자유 keeps the box and only unlocks the ratio.
    setCropDraft({ ...draft, crop: aspect === 'free' ? { ...draft.crop, aspect } : centeredCrop(draft, aspect) })
  }
  function chooseCropOrientation(portrait: boolean) {
    setCropPortrait(portrait)
    const draft = cropDraftRef.current
    if (draft && hasOrientation(draft.crop.aspect) && isPortraitAspect(draft.crop.aspect) !== portrait) setCropDraft({ ...draft, crop: centeredCrop(draft, orient(draft.crop.aspect, portrait)) })
  }
  function resetCrop() { const draft = cropDraftRef.current; if (draft) setCropDraft({ ...draft, crop: fullCrop(draft) }) }
  function finishCrop() { commitCrop(); openTab('stickers') }
  function cancelCrop() { cropDraftRef.current = null; setCropDraftState(null); openTab('stickers') }
  function applyCropToAll() {
    commitCrop()
    const aspect = cropDraftRef.current?.crop.aspect
    if (!aspect || aspect === 'free' || aspect === 'original') return
    let count = 0
    for (const item of photos) {
      const session = sessions.current.get(item.id)
      if (!session || item.id === activeId.current) continue
      // Same ratio, each photo in its own orientation (like the 가로/세로 사진 sizes in 저장 설정); a photo already cut to it keeps its own position.
      const own = orient(aspect, item.height > item.width), present = session.history.present
      if (present.crop?.aspect === own) continue
      const crop = normalizeCrop(centeredCrop(item, own), item)
      if (sameCrop(present.crop, crop)) continue
      sessions.current.set(item.id, editPhotoSession(session, commitScene(session.history, { ...present, crop })))
      count++
    }
    const landscape = orient(aspect, false), portrait = orient(aspect, true)
    const ratio = landscape === portrait ? landscape : `가로 사진 ${landscape}, 세로 사진 ${portrait}`
    setStatus(count ? `다른 사진 ${count}장을 ${ratio} 비율로 가운데를 잘랐습니다. 사진마다 위치를 고치거나 실행 취소할 수 있습니다.` : `다른 사진이 이미 ${ratio} 비율로 잘려 있습니다.`)
  }
  function drawRegion(value: Placement) {
    if (!photo) return
    try {
      editScene(addRegion(currentHistory.current.present, { id: crypto.randomUUID(), ...value, ...regionDefaults }))
      setStatus('')
    } catch (value) { setError(value instanceof Error ? value.message : '영역을 만들 수 없습니다.') }
  }
  /** Switching tools drops a selection that belongs to the other layer. */
  function openTab(tab: SideTab) {
    const current = currentHistory.current.present
    const kind = selectedKind(current)
    // The adjust tab keeps a sticker/text selection (as before); the other tabs only keep their own kind.
    if (kind && (tab === 'adjust' ? kind === 'regions' : kind !== tab)) selectInstance(null)
    if (tab !== 'crop') commitCrop()
    setSideTab(tab)
  }
  /** Selecting on the canvas brings up the tab that edits that item. */
  function selectFromCanvas(id: string | null) {
    selectInstance(id)
    const current = currentHistory.current.present
    if (mode === 'thumb') { if (id) setThumbTab(current.texts.some(item => item.id === id) ? 'text' : 'deco'); return }
    if (!id || sideTab === 'adjust') return
    if (current.texts.some(item => item.id === id)) setSideTab('text')
    else if (current.stickers.some(item => item.id === id)) setSideTab('stickers')
  }
  /** The part of the photo that is shown and saved (the crop, or all of it); new stickers and texts land in its middle. */
  const view = photo ? cropArea(scene.crop, photo) : null
  const shortEdge = view ? Math.min(view.width, view.height) : 1000
  const maxFontSize = Math.max(64, Math.round(shortEdge * 0.5))
  function rememberText(next: TextDefaults) { setTextDefaults(next); savePref('pk.textDefaults', next) }
  const addTextItem = () => run(async () => {
    if (!photo) return
    const current = currentHistory.current.present
    if (current.texts.length >= MAX_TEXTS) throw new Error('사진 한 장에는 글자를 최대 50개 넣을 수 있습니다.')
    await ensureFont(textDefaults.style.font, textDefaults.style.bold)
    const fontSize = Math.min(maxFontSize, Math.max(8, Math.round(textDefaults.relSize * shortEdge)))
    // Each new text lands a line below the previous one so they do not pile up.
    const offset = (current.texts.length % 4) * fontSize * 1.6
    const measured = withMeasuredSize({ text: DEFAULT_TEXT, fontSize, style: { ...textDefaults.style } })
    const area = cropArea(current.crop, photo)
    editScene(addText(currentHistory.current.present, { id: crypto.randomUUID(), ...measured, x: area.x + area.width / 2, y: Math.min(area.y + area.height, area.y + area.height / 2 + offset), rotation: 0 }))
    if (mode === 'thumb') setThumbTab('text'); else setSideTab('text')
    setStatus('글자를 추가했습니다. 오른쪽 입력칸에 내용을 쓰고, 사진 위에서 옮기거나 모서리로 크기를 바꾸세요.')
    focusNewText.current = true
  })
  /** Re-measures the selected text after a content/size/style change; live edits merge into one undo step. */
  function changeText(change: Partial<Pick<TextItem, 'text' | 'fontSize' | 'style'>>, live = false) {
    const current = currentHistory.current.present
    const item = current.texts.find(text => text.id === current.selectedId)
    if (!item) return
    const measured = withMeasuredSize({ text: item.text, fontSize: item.fontSize, style: item.style, ...change })
    const next = updateSelectedText(current, measured)
    if (live) liveEdit(next); else editScene(next)
  }
  function changeTextStyle(patch: Partial<TextStyle>, live = false) {
    const style = { ...(textItem?.style ?? textDefaults.style), ...patch }
    if (!validTextStyle(style)) return
    rememberText({ ...textDefaults, style })
    // Without a selection only the defaults change; load the face so the input preview shows it.
    if (!textItem) { void ensureFont(style.font, style.bold).catch(() => undefined); return }
    const id = textItem.id
    if (patch.font === undefined && patch.bold === undefined) { changeText({ style }, live); return }
    // A new face must be loaded before measuring, or the box would fit the fallback font.
    void run(async () => {
      await ensureFont(style.font, style.bold)
      if (currentHistory.current.present.selectedId === id) changeText({ style })
    })
  }
  /** Saves the look in the panel (selected text, else the defaults) as "내 스타일"; content is not part of it. */
  function saveMyPreset() {
    const preset = { style: { ...(textItem?.style ?? textDefaults.style) }, relSize: textItem ? Math.min(1, textItem.fontSize / shortEdge) : textDefaults.relSize }
    if (myPresets.some(item => samePreset(item, preset))) { setStatus('같은 스타일이 이미 내 스타일에 있습니다.'); return }
    if (myPresets.length >= MAX_MY_PRESETS) return
    storeMyPresets([{ id: crypto.randomUUID(), ...preset }, ...myPresets])
    setStatus('지금 스타일을 내 스타일에 저장했습니다. 다시 실행해도 남아 있습니다.')
  }
  /** Applies a saved look including font and size (size follows the photo's short edge). */
  function applyMyPreset(preset: MyPreset) {
    rememberText({ style: { ...preset.style }, relSize: preset.relSize })
    const id = textItem?.id
    void run(async () => {
      await ensureFont(preset.style.font, preset.style.bold)
      if (!id || currentHistory.current.present.selectedId !== id) return
      changeText({ style: { ...preset.style }, fontSize: Math.min(maxFontSize, Math.max(8, Math.round(preset.relSize * shortEdge))) })
    })
  }
  function changeFontSize(size: number, live = false) {
    if (!textItem || !validFontSize(size)) return
    rememberText({ ...textDefaults, relSize: Math.min(1, size / shortEdge) })
    changeText({ fontSize: size }, live)
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
    const folder = await window.photokkumi.getOutputFolder()
    if (folder.ok) setOutputFolder(folder.value)
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
    try {
      if (currentHistory.current.present.stickers.length >= MAX_INSTANCES) throw new Error('사진 한 장에는 스티커를 최대 200개 배치할 수 있습니다.')
      let decoded = assets.current.get(asset.id)
      if (!decoded) {
        const total = [...assets.current.values()].reduce((sum, item) => sum + item.width * item.height, 0)
        if (total + asset.width * asset.height > MAX_DECODED_STICKER_PIXELS) throw new Error('스티커 이미지 메모리 한도입니다. 배치·실행취소 이력을 비운 뒤 다시 시도하세요.')
        decoded = await decode(asset)
        assets.current.set(asset.id, decoded)
      }
      const area = cropArea(currentHistory.current.present.crop, photo)
      const width = Math.min(decoded.width, area.width / 3)
      const offset = Math.min((currentHistory.current.present.stickers.length % 10) * 20, area.width / 8, area.height / 8)
      editScene(addInstance(currentHistory.current.present, {
        id: crypto.randomUUID(), assetId: decoded.id, x: area.x + area.width / 2 + offset, y: area.y + area.height / 2 + offset,
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
    const next = updateSelected({ ...current, selectedId: id }, value)
    editScene(next)
    // A text resized with the handles makes its size the default for the next text (like the size field does).
    const before = current.texts.find(item => item.id === id), after = next.texts.find(item => item.id === id)
    if (before && after && after.fontSize !== before.fontSize) rememberText({ ...textDefaults, relSize: Math.min(1, after.fontSize / shortEdge) })
  }
  function handleEditorKey(event: KeyboardEvent<HTMLElement>) {
    const target = event.target
    if (mode === 'gif') return
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.altKey
      || operation.current || closeRequest || pendingPhoto || libraryOpen || (target instanceof HTMLElement
        && (target.isContentEditable || target.closest('input, textarea, select, dialog, [role="textbox"]')))) return
    if (cropMode) {
      const plain = !event.ctrlKey && !event.metaKey
      if (event.key === 'Escape') { event.preventDefault(); cancelCrop(); return }
      // Enter on a focused panel button presses that button instead.
      if (event.key === 'Enter' && plain && !(target instanceof HTMLElement && target.closest('button'))) { event.preventDefault(); finishCrop(); return }
      if (plain && !event.shiftKey && event.key.toLowerCase() === 'c' && !event.repeat) { event.preventDefault(); finishCrop(); return }
      const step = event.shiftKey ? 10 : 1
      const delta = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] } as Record<string, [number, number]>)[event.key]
      const draft = cropDraftRef.current
      if (delta && plain && draft) { event.preventDefault(); changeCropRect(moveCrop(draft.crop, draft.crop.x + delta[0], draft.crop.y + delta[1], draft)); return }
      // Undo/redo first keeps the box as one step; other shortcuts (T, Delete, …) wait until the crop is done.
      if (plain) return
      commitCrop()
    }
    if (photo && mode === 'photo' && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.key.toLowerCase() === 'c' && !event.repeat) { event.preventDefault(); openTab('crop'); return }
    if (event.key === 'Escape' && drawMode) { event.preventDefault(); openTab('stickers'); return }
    if (photo && mode === 'photo' && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.key.toLowerCase() === 'b' && !event.repeat) { event.preventDefault(); openTab(sideTab === 'regions' ? 'stickers' : 'regions'); return }
    if (photo && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.key.toLowerCase() === 't' && !event.repeat && !drawMode) { event.preventDefault(); void addTextItem(); return }
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
    const selected = [...current.stickers, ...current.regions, ...current.shapes, ...current.texts].find(item => item.id === current.selectedId)
    if (!selected) {
      // Nothing selected on the thumbnail: Delete takes the photo out of the background (undoable).
      if (mode === 'thumb' && (event.key === 'Delete' || event.key === 'Backspace') && current.background?.photoId && !event.repeat
        && !(target instanceof HTMLElement && target.closest('aside'))) {
        event.preventDefault(); changeBackground({ photoId: null, hidePhoto: undefined }); setStatus('배경 사진을 뺐습니다. Ctrl+Z로 되돌릴 수 있습니다.')
      }
      return
    }
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
    if (!window.confirm('사진의 모든 스티커·가림·글자와 실행취소 이력을 비울까요? 이 작업은 실행 취소할 수 없습니다.')) return
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
    setPhoto(decoded); setDirty(session.dirty)
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
    const before = new Set(photos.map(item => item.id))
    await acceptBatch(imported, rejected)
    // A dropped video opens the GIF maker; a photo dropped on the thumbnail becomes its background; other photo drops bring the editor forward.
    const added = imported.find(item => !before.has(item.id))
    if (videos[0]) { setMode('gif'); setIncomingVideo({ ref: videos[0], nonce: Date.now() }) }
    else if (mode === 'thumb') { if (added) changeBackground({ photoId: added.id, zoom: 100, focusX: 50, focusY: 50, hidePhoto: undefined }) }
    else if (added || !rejected.length) {
      if (activeId.current === THUMB) await restorePhotoSession()
      setMode('photo')
    }
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
    if (photoModeId.current === id) photoModeId.current = null
    if (activeId.current === id) {
      activeId.current = null
      const next = emptyHistory()
      currentHistory.current = next; setHistory(next); setPhoto(null); setDirty(false)
    }
    // The thumbnail must not keep (or be able to undo back to) a photo that left the list.
    const thumb = sessions.current.get(THUMB)
    const scrub = (item: Scene) => item.background?.photoId === id ? { ...item, background: { ...item.background, photoId: null, hidePhoto: undefined } } : item
    if (thumb && [thumb.history.present, ...thumb.history.past, ...thumb.history.future].some(item => item.background?.photoId === id)) {
      const scrubbed = { present: scrub(thumb.history.present), past: thumb.history.past.map(scrub), future: thumb.history.future.map(scrub) }
      if (activeId.current === THUMB) applyHistory(scrubbed)
      else sessions.current.set(THUMB, editPhotoSession(thumb, scrubbed))
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
    // A crop still being edited counts as an edit of this photo.
    commitCrop()
    if (activeId.current && sessions.current.get(activeId.current)?.dirty) { setPendingPhoto(id); switchDialog.current?.showModal() }
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
    // A failed save must not leave "저장 중…" behind; the error itself is shown as an alert.
    try { return await writeCurrent() } catch (error) { setStatus(''); throw error }
  }
  async function writeCurrent(): Promise<boolean> {
    const photo = livePhoto.current
    if (!photo || photo.id === THUMB) return false
    if (!outputLoaded) throw new Error('출력 설정을 불러온 뒤 저장할 수 있습니다.')
    // Typing, a slider drag or a crop still in progress becomes its undo step now, not after the save marks the photo clean.
    commitLive(); commitCrop()
    const area = cropArea(currentHistory.current.present.crop, photo)
    outputSize(area.width, area.height, output)
    setStatus('저장 중…')
    const persisted = await window.photokkumi.updateOutputSettings(output)
    if (!persisted.ok) throw new Error(persisted.error)
    const present = currentHistory.current.present
    const png = await composePng(photo.bitmap, present.stickers, assets.current, output, present.regions, present.adjust, present.texts, [], present.crop)
    const result = await window.photokkumi.saveImage({ photoId: photo.id, png, output, ...(present.crop ? { crop: cropArea(present.crop, photo) } : {}) })
    if (!result.ok) throw new Error(result.error)
    if (!result.value) { setStatus('저장이 취소되었습니다. 편집 내용은 유지됩니다.'); return false }
    sessions.current.set(photo.id, savePhotoSession(sessions.current.get(photo.id)!, outputKey(output), result.value.folderLabel))
    setOutputFolder(result.value.folderLabel)
    setDirty(false); setStatus(`저장 완료 · ${result.value.name}`)
    await syncReferences(photo.id)
    return true
  }
  const save = () => run(async () => { await saveCurrent() })
  async function updateAction(action: 'check' | 'download' | 'install') {
    setError('')
    const result = action === 'check' ? await window.photokkumi.checkForUpdate() : action === 'download' ? await window.photokkumi.downloadUpdate() : await window.photokkumi.installUpdate()
    if (!result.ok) { setError(result.error); return }
    if (action === 'install') return
    const state = result.value as UpdateState
    setUpdate(state)
    if (action === 'check') { setDismissedUpdate(null); setStatus(state.status === 'idle' ? `최신 버전입니다 (v${state.current}).` : state.status === 'available' ? `새 버전 ${state.version}이 있습니다.` : '') }
  }
  const photoIndex = photos.findIndex(item => item.id === photo?.id)
  const saveNext = () => run(async () => {
    if (!photo) return
    commitCrop()
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
  /** Close dialog "저장": the thumbnail and the editor's photo, whichever has unsaved edits. */
  async function saveAllDirty(): Promise<boolean> {
    commitCrop()
    if (sessions.current.get(THUMB)?.dirty && !await saveThumbCurrent()) return false
    const photoId = activeId.current === THUMB ? photoModeId.current : activeId.current
    if (!photoId || !sessions.current.get(photoId)?.dirty) return true
    if (activeId.current === THUMB) { await restorePhotoSession(); setMode('photo') }
    return saveCurrent()
  }
  const saveAndClose = () => run(async () => {
    try {
      if (await saveAllDirty()) await resolveClose('close')
      else await resolveClose('cancel')
    } catch (error) {
      await resolveClose('cancel')
      throw error
    }
  })
  // ---- 썸네일 만들기 ----
  async function thumbPhotoSource(id: string | null): Promise<ImageBitmap | null> {
    if (!id) return null
    if (thumbSource.current?.id === id) return thumbSource.current.bitmap
    const result = await window.photokkumi.readPhoto(id)
    if (!result.ok) throw new Error(result.error)
    const decoded = await decode(result.value)
    if (thumbSource.current?.id === id) { decoded.bitmap.close(); return thumbSource.current.bitmap }
    const old = thumbSource.current
    thumbSource.current = { id, bitmap: decoded.bitmap }
    setThumbPhoto(decoded.bitmap)
    // Previews still drawing the old photo finish first.
    if (old) setTimeout(() => old.bitmap.close(), 1000)
    return decoded.bitmap
  }
  // The background (color, cover-cropped photo, dim) is the thumbnail's "photo": the canvas and the export draw everything else on it.
  const background = mode === 'thumb' ? scene.background : undefined
  useEffect(() => {
    if (!background || activeId.current !== THUMB) return
    let alive = true
    void thumbPhotoSource(background.photoId).catch(value => { if (alive) setError(value instanceof Error ? value.message : '배경 사진을 읽을 수 없습니다.'); return null }).then(source => {
      if (!alive) return
      setPhoto({ id: THUMB, name: '썸네일', width: THUMB_SIZE, height: THUMB_SIZE, mime: 'image/png', bitmap: renderBackground(background, source) })
    })
    return () => { alive = false }
    // thumbPhotoSource only reads refs and state setters.
  }, [background])
  async function openThumbSession() {
    if (activeId.current && activeId.current !== THUMB) photoModeId.current = activeId.current
    let session = sessions.current.get(THUMB)
    if (!session) {
      // The first thumbnail starts from the first template, with the photo open in the editor as its background.
      const layout = await layoutTemplate(THUMB_TEMPLATES[0], undefined, { ...DEFAULT_BACKGROUND, photoId: photoModeId.current }, [])
      const created = createPhotoSession(), present = applyLayout(created.history.present, layout)
      session = { ...created, history: { present, past: [], future: [] }, checkpoint: present }
      sessions.current.set(THUMB, session)
    }
    activeId.current = THUMB
    currentHistory.current = session.history; setHistory(session.history); liveBase.current = null
    setPhoto(null); setDirty(session.dirty)
    setStatus('템플릿을 고르고, 사진을 넣고, 글자를 눌러 바꾸세요. 1080×1080으로 저장합니다.')
  }
  async function restorePhotoSession() {
    activeId.current = null
    const id = photoModeId.current && sessions.current.has(photoModeId.current) ? photoModeId.current : photos[0]?.id
    setPhoto(null)
    if (id) { await activatePhoto(id); return }
    const next = emptyHistory()
    currentHistory.current = next; setHistory(next); setDirty(false); setStatus('사진을 열어 시작하세요.')
  }
  const switchMode = (next: 'photo' | 'gif' | 'thumb') => {
    if (next === mode) return
    setSettingsOpen(false)
    if (next === 'gif' || (next === 'photo' && activeId.current !== THUMB)) { commitLive(); setMode(next); return }
    void run(async () => {
      commitLive()
      if (next === 'thumb') await openThumbSession(); else await restorePhotoSession()
      setMode(next)
    })
  }
  function changeBackground(patch: Partial<ThumbBackground>, live = false) {
    const current = currentHistory.current.present
    if (!current.background) return
    const next = { ...current.background, ...patch }
    if (!validBackground(next)) return
    const scene = setBackground(current, next)
    if (live) liveEdit(scene); else editScene(scene)
  }
  const openThumbPhoto = () => run(async () => {
    const before = new Set(photos.map(item => item.id))
    const result = await window.photokkumi.choosePhotos()
    if (!result.ok) throw new Error(result.error)
    if (!result.value) return
    await acceptBatch(result.value, [])
    const added = result.value.find(item => !before.has(item.id))
    if (added) { changeBackground({ photoId: added.id, zoom: 100, focusX: 50, focusY: 50, hidePhoto: undefined }); setStatus(`${added.name}을(를) 배경에 넣었습니다. 배경 탭에서 확대·위치·어둡게를 조절하세요.`) }
    else setStatus('이미 열린 사진입니다. 배경 탭의 사진 목록에서 고르세요.')
  })
  const applyThumbTemplate = (template: ThumbTemplate) => run(async () => {
    commitLive()
    const current = currentHistory.current.present
    const layout = await layoutTemplate(template, current.theme, current.background ?? DEFAULT_BACKGROUND, current.texts)
    editScene(applyLayout(currentHistory.current.present, layout))
    setStatus(`'${template.name}' 템플릿을 적용했습니다. 글자를 눌러 내용을 바꾸세요. 실행 취소(Ctrl+Z)로 되돌릴 수 있습니다.`)
  })
  function chooseTheme(id: string | undefined) {
    commitLive()
    const current = currentHistory.current.present
    if (current.theme === id) return
    const template = templateById(current.template)
    const colors = id ? palette(id) : template ? templateColors(template, undefined) : undefined
    editScene({ ...(colors ? applyTheme(current, colors) : current), theme: id })
  }
  function addShapeItem(preset: ShapePreset) {
    const current = currentHistory.current.present
    const accent = (palette(current.theme) ?? templateColors(templateById(current.template) ?? THUMB_TEMPLATES[0], undefined)).accent
    const offset = (current.shapes.length % 5) * 24
    const base: ShapeItem = { id: crypto.randomUUID(), kind: 'rect', x: 540 + offset, y: 540 + offset, width: 420, height: 300, rotation: 0,
      fill: accent, fillOpacity: 100, stroke: '#ffffff', strokeWidth: 0, radius: 0, shadow: false }
    const shape: ShapeItem = preset === 'round' ? { ...base, radius: 15 } : preset === 'ellipse' ? { ...base, kind: 'ellipse', width: 360, height: 360 }
      : preset === 'frame' ? { ...base, width: 640, height: 640, fillOpacity: 0, strokeWidth: 10 } : preset === 'line' ? { ...base, width: 400, height: 8, fill: '#ffffff' } : base
    try { editScene(addShape(current, shape)); setThumbTab('deco') }
    catch (value) { setError(value instanceof Error ? value.message : '도형을 넣을 수 없습니다.') }
  }
  function changeShapeStyle(patch: Partial<ShapeStyle>, live = false) {
    const current = currentHistory.current.present
    const shape = current.shapes.find(item => item.id === current.selectedId)
    if (!shape) return
    const style = { ...Object.fromEntries(SHAPE_STYLE_KEYS.map(key => [key, shape[key]])), ...patch } as ShapeStyle
    try { const next = updateSelectedShape(current, style); if (live) liveEdit(next); else editScene(next) } catch { /* out-of-range input: keep the shape */ }
  }
  function storeMyTemplates(next: MyTemplate[]): boolean {
    try { localStorage.setItem('pk.thumbTemplates', JSON.stringify(next)) }
    catch { setError('내 템플릿을 저장할 공간이 부족합니다. 쓰지 않는 내 템플릿을 지운 뒤 다시 저장하세요.'); return false }
    setMyTemplates(next); return true
  }
  const saveMyTemplate = () => run(async () => {
    commitLive()
    const current = currentHistory.current.present
    if (!current.background || myTemplates.length >= MAX_MY_TEMPLATES) return
    const layout: ThumbLayout = { background: { ...current.background, photoId: null }, shapes: current.shapes, texts: current.texts, template: current.template }
    await ensureTextFonts(current.texts)
    const canvas = new OffscreenCanvas(208, 208), context = canvas.getContext('2d')
    if (!context) throw new Error('미리보기를 만들 수 없습니다.')
    drawLayout(context, layout, await thumbPhotoSource(current.background.photoId).catch(() => null), 208)
    const preview = await blobUrl(await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 }))
    const number = Math.max(0, ...myTemplates.map(item => Number(/^내 템플릿 (\d+)$/.exec(item.name)?.[1] ?? 0))) + 1
    const name = `내 템플릿 ${number}`
    if (storeMyTemplates([{ id: crypto.randomUUID(), name, layout, theme: current.theme, preview }, ...myTemplates])) {
      setTemplateFilter('mine'); setThumbTab('template')
      setStatus(`${name}에 지금 배치·글자·색을 저장했습니다. 사진과 스티커는 저장하지 않습니다.`)
    }
  })
  const applyMyTemplate = (template: MyTemplate) => run(async () => {
    commitLive()
    const current = currentHistory.current.present, keep = current.background ?? DEFAULT_BACKGROUND
    await ensureTextFonts(template.layout.texts)
    const fresh = <T extends { id: string }>(item: T): T => ({ ...item, id: crypto.randomUUID() })
    const layout = { ...template.layout, background: { ...template.layout.background, photoId: keep.photoId, zoom: keep.zoom, focusX: keep.focusX, focusY: keep.focusY },
      shapes: template.layout.shapes.map(fresh), texts: template.layout.texts.map(fresh) }
    editScene({ ...applyLayout(currentHistory.current.present, layout), theme: template.theme })
    setStatus(`${template.name}을(를) 적용했습니다.`)
  })
  async function saveThumbCurrent(): Promise<boolean> {
    try { return await writeThumb() } catch (error) { setStatus(''); throw error }
  }
  async function writeThumb(): Promise<boolean> {
    if (activeId.current === THUMB) commitLive()
    const session = sessions.current.get(THUMB)
    if (!session) return false
    const present = session.history.present, back = present.background ?? DEFAULT_BACKGROUND
    setStatus('저장 중…')
    const base = renderBackground(back, await thumbPhotoSource(back.photoId))
    let png: Uint8Array
    try { png = await composePng(base, present.stickers, assets.current, { ...DEFAULT_OUTPUT, format: thumbFormat }, [], NEUTRAL_ADJUSTMENTS, present.texts, present.shapes) }
    finally { base.close() }
    // Named after the background photo while it is still in the photo list.
    const photoId = back.photoId && photos.some(item => item.id === back.photoId) ? back.photoId : null
    const result = await window.photokkumi.saveThumbnail({ photoId, png, format: thumbFormat })
    if (!result.ok) throw new Error(result.error)
    if (!result.value) { setStatus('저장이 취소되었습니다. 만든 썸네일은 유지됩니다.'); return false }
    sessions.current.set(THUMB, savePhotoSession(sessions.current.get(THUMB)!, null, result.value.folderLabel))
    if (activeId.current === THUMB) setDirty(false)
    setOutputFolder(result.value.folderLabel)
    setStatus(`썸네일 저장 완료 · ${result.value.name} (1080 × 1080)`)
    await syncReferences(THUMB)
    return true
  }
  const saveThumb = () => run(async () => { await saveThumbCurrent() })

  let outputError = '', outputLabel = ''
  try {
    if (!validOutput(output)) throw new Error('출력 길이는 1~8192 정수로 입력하세요. JPG 품질은 100입니다.')
    if (photo) { const area = cropArea(cropMode && cropDraft ? cropDraft.crop : scene.crop, photo), size = outputSize(area.width, area.height, output); outputLabel = `${size.width} × ${size.height} px` }
  } catch (value) { outputError = value instanceof Error ? value.message : '출력 설정을 확인하세요.' }
  const libraryProps = { items: libraryItems, disabled: busy, canUse: !!photo, activeIds: referencedIds,
    onUse: useSticker, onImport: importStickers, onBackup: backupLibrary, onRestore: restoreLibrary,
    onUpdate: updateSticker, onDelete: deleteSticker }
  const outputSummary = `${output.format === 'jpg' ? 'JPG' : 'PNG'} · ${output.resizeEnabled ? `${output.resizeBasis === 'width' ? '가로' : '긴 축'} ${output.landscapeSize}/${output.portraitSize}px` : '원본 크기'}`
  const photoState = (session: PhotoSession) => session.dirty ? (session.saved ? '저장 후 수정' : '수정됨') : session.saved ? (session.outputKey !== outputKey(output) ? '출력 설정 변경' : session.savedFolder !== outputFolder ? '출력 폴더 변경' : '저장 완료') : '미작업'
  const canSave = !busy && !!photo && outputLoaded && !outputError
  // Ctrl/Cmd+S saves the current photo in place (no move); the toolbar keeps only 저장하고 다음.
  const saveShortcut = useRef(() => {})
  // Any open modal (close/switch confirmation, sticker manager) blocks it; state flags clear a tick later than the dialog closes.
  saveShortcut.current = () => {
    if (document.querySelector('dialog[open]')) return
    if (mode === 'thumb' && !busy) void saveThumb()
    else if (mode === 'photo' && canSave) void save()
  }
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 's') return
      event.preventDefault()
      if (!event.repeat) saveShortcut.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes('Files')
  const dropBlocked = busy || gifBusy || !!pendingPhoto || !!closeRequest || libraryOpen
  const effect: RegionEffect = region ? { style: region.style, strength: region.strength, shape: region.shape ?? 'ellipse' } : regionDefaults
  const numericFields = selection ? <div className="placement-detail">
    <button className="disclosure" aria-expanded={fieldsOpen} onClick={toggleFields}><span className="chevron" aria-hidden="true">▸</span>위치·크기 숫자로 조정</button>
    {fieldsOpen && <fieldset className="placement-fields" disabled={busy} title="원본 픽셀 기준">
              <label>X<input aria-label="중심 X" type="number" value={Math.round(selection.x)} onChange={e => change({ ...selection, x: e.target.valueAsNumber })} /></label>
              <label>Y<input aria-label="중심 Y" type="number" value={Math.round(selection.y)} onChange={e => change({ ...selection, y: e.target.valueAsNumber })} /></label>
              {shapeItem ? <>
                <label>너비<input aria-label="도형 너비" type="number" min="1" max="32768" value={Math.round(shapeItem.width)} onChange={e => change({ ...shapeItem, width: e.target.valueAsNumber })} /></label>
                <label>높이<input aria-label="도형 높이" type="number" min="1" max="32768" value={Math.round(shapeItem.height)} onChange={e => change({ ...shapeItem, height: e.target.valueAsNumber })} /></label>
              </> : region ? <>
                <label>너비<input aria-label="영역 너비" type="number" min="1" max="32768" value={Math.round(region.width)} onChange={e => change({ ...region, width: e.target.valueAsNumber })} /></label>
                <label>높이<input aria-label="영역 높이" type="number" min="1" max="32768" value={Math.round(region.height)} onChange={e => change({ ...region, height: e.target.valueAsNumber })} /></label>
              </> : textItem ? null : <label>너비<input aria-label="스티커 너비" type="number" min="1" max="32768" value={Math.round(selection.width)} onChange={e => change({ ...selection, width: e.target.valueAsNumber, height: e.target.valueAsNumber * selection.height / selection.width })} /></label>}
              <label>회전<input aria-label="회전" type="number" value={Math.round(selection.rotation)} onChange={e => change({ ...selection, rotation: e.target.valueAsNumber })} /></label>
            </fieldset>}
  </div> : null
  // Files dropped on the sticker library register as stickers; anywhere else they open as photos/videos.
  const dropZone = (event: DragEvent): 'photos' | 'stickers' => mode === 'photo' && sideTab === 'stickers' && (event.target as Element).closest?.('.library-pane') ? 'stickers' : 'photos'
  const editTools = selection ? <>
    <button className="icon" aria-label="선택 복제" title="복제 (Ctrl+D)" onClick={duplicate}><svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 3.5v-.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.5"/></svg></button>
    {placement && <>
      <button className="icon" aria-label="위로" title="한 단계 위로 (다른 스티커 위에 겹치기)" disabled={placement.zOrder === scene.stickers.length - 1} onClick={() => editScene(reorderSelected(currentHistory.current.present, 1))}><svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="6.5" width="7" height="7" rx="1" strokeDasharray="2 1.6"/><rect x="6.5" y="2.5" width="7" height="7" rx="1" fill="currentColor" fillOpacity=".25"/></svg></button>
      <button className="icon" aria-label="아래로" title="한 단계 아래로 (다른 스티커 밑으로)" disabled={placement.zOrder === 0} onClick={() => editScene(reorderSelected(currentHistory.current.present, -1))}><svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="6.5" y="2.5" width="7" height="7" rx="1"/><rect x="2.5" y="6.5" width="7" height="7" rx="1" fill="currentColor" fillOpacity=".25" strokeDasharray="2 1.6"/></svg></button>
    </>}
    {shapeItem && <>
      <button className="icon" aria-label="위로" title="한 단계 앞으로 (다른 도형 위에 겹치기)" disabled={scene.shapes.at(-1)?.id === shapeItem.id} onClick={() => editScene(reorderSelected(currentHistory.current.present, 1))}><svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="6.5" width="7" height="7" rx="1" strokeDasharray="2 1.6"/><rect x="6.5" y="2.5" width="7" height="7" rx="1" fill="currentColor" fillOpacity=".25"/></svg></button>
      <button className="icon" aria-label="아래로" title="한 단계 뒤로 (다른 도형 밑으로)" disabled={scene.shapes[0]?.id === shapeItem.id} onClick={() => editScene(reorderSelected(currentHistory.current.present, -1))}><svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="6.5" y="2.5" width="7" height="7" rx="1"/><rect x="2.5" y="6.5" width="7" height="7" rx="1" fill="currentColor" fillOpacity=".25" strokeDasharray="2 1.6"/></svg></button>
    </>}
    <button className="icon danger" aria-label="선택 삭제" title="삭제 (Delete)" onClick={() => editScene(removeSelected(currentHistory.current.present))}><svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 4.5h11M6.5 4.5V3a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v1.5M4 4.5l.7 8.6a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.7-8.6"/></svg></button>
  </> : null
  const textPanel = <TextPanel photoOpen={!!photo} busy={busy} texts={scene.texts} selected={textItem}
          style={textItem?.style ?? textDefaults.style} fontSize={textItem?.fontSize ?? null} maxFontSize={maxFontSize} systemFonts={systemFonts} textArea={textArea}
          myPresets={myPresets} onSaveMine={saveMyPreset} onApplyMine={applyMyPreset} onDeleteMine={id => storeMyPresets(myPresets.filter(item => item.id !== id))}
          onAdd={() => void addTextItem()} onSelect={selectInstance} onText={text => changeText({ text }, true)} onStyle={changeTextStyle} onFontSize={changeFontSize}
          onCommit={commitLive} onClear={() => editScene(clearTexts(currentHistory.current.present))}>
          {textItem ? numericFields : <p className="hint">{photo ? '글자를 누르면 선택됩니다. 모서리를 끌면 크기, 위쪽 핸들로 회전합니다. 방향키 1px, Shift+방향키 10px 이동.' : ''}</p>}
        </TextPanel>
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
      : <div><strong>여기에 놓으면 불러옵니다</strong><span>JPG·PNG·HEIC 사진, 사진이 든 폴더, MOV·MP4 동영상 · 스티커 목록 위에 놓으면 스티커로 등록</span></div>}</div>}
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
        <button role="tab" aria-selected={mode === 'photo'} disabled={gifBusy} onClick={() => switchMode('photo')}><span className="label">사진 편집</span><span className="label-short">사진</span></button>
        <button role="tab" aria-selected={mode === 'thumb'} disabled={busy || gifBusy} onClick={() => switchMode('thumb')}><span className="label">썸네일 만들기</span><span className="label-short">썸네일</span></button>
        <button role="tab" aria-selected={mode === 'gif'} disabled={busy} onClick={() => switchMode('gif')}><span className="label">GIF 만들기</span><span className="label-short">GIF</span></button>
      </div>
      <div className="photo-tools" hidden={mode !== 'thumb'}>
        <nav aria-label="썸네일 사진" className="toolbar-group">
          <button onClick={openThumbPhoto} disabled={busy} title="배경에 넣을 사진을 고릅니다">사진 넣기</button>
        </nav>
        <div className="toolbar-group" aria-label="썸네일 편집 이력">
          <button className="icon" aria-label="실행 취소" title="실행 취소 (Ctrl+Z)" disabled={busy || !history.past.length} onClick={() => applyHistory(undoScene(currentHistory.current))}><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5.5 3.5 2.5 6.5l3 3"/><path d="M2.5 6.5h7a4 4 0 0 1 0 8H7"/></svg></button>
          <button className="icon" aria-label="다시 실행" title="다시 실행 (Ctrl+Shift+Z)" disabled={busy || !history.future.length} onClick={() => applyHistory(redoScene(currentHistory.current))}><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="m10.5 3.5 3 3-3 3"/><path d="M13.5 6.5h-7a4 4 0 0 0 0 8H9"/></svg></button>
        </div>
        <div className="toolbar-group">
          <button className="text-toggle" aria-label="글자 넣기" disabled={busy || !photo} title="글자 넣기 (T)" onClick={() => void addTextItem()}>
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M3 3.5h10M8 3.5v10"/></svg><span className="label"> 글자</span>
          </button>
        </div>
        <div className="toolbar-spacer" />
        <label className="thumb-format" title="블로그에는 JPG가 가볍습니다">형식
          <select aria-label="썸네일 형식" value={thumbFormat} disabled={busy} onChange={e => { const value = e.target.value as 'jpg' | 'png'; setThumbFormat(value); savePref('pk.thumbFormat', value) }}>
            <option value="jpg">JPG</option><option value="png">PNG</option>
          </select>
        </label>
        <button className="primary" onClick={saveThumb} disabled={busy || !photo} title="1080×1080으로 출력 폴더에 저장 (Ctrl+S)">{busy ? '처리 중…' : '썸네일 저장'}</button>
      </div>
      <div className="photo-tools" hidden={mode !== 'photo'}>
      <nav aria-label="파일 작업" className="toolbar-group">
        <button onClick={choosePhoto} disabled={busy || !!pendingPhoto}>사진 열기</button>
        <button onClick={choosePhotoFolder} disabled={busy || !!pendingPhoto}>폴더 열기</button>
      </nav>
      <div className="toolbar-group" aria-label="편집 이력">
        <button className="icon" aria-label="실행 취소" title="실행 취소 (Ctrl+Z)" disabled={busy || !history.past.length} onClick={() => { commitCrop(); applyHistory(undoScene(currentHistory.current)) }}><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5.5 3.5 2.5 6.5l3 3"/><path d="M2.5 6.5h7a4 4 0 0 1 0 8H7"/></svg></button>
        <button className="icon" aria-label="다시 실행" title="다시 실행 (Ctrl+Shift+Z)" disabled={busy || !history.future.length} onClick={() => { commitCrop(); applyHistory(redoScene(currentHistory.current)) }}><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="m10.5 3.5 3 3-3 3"/><path d="M13.5 6.5h-7a4 4 0 0 0 0 8H9"/></svg></button>
      </div>
      <div className="toolbar-group">
        <button className="draw-toggle" aria-label="블러·모자이크" aria-pressed={drawMode} disabled={busy || !photo} title="블러·모자이크 도구 (B) — 켜 둔 채로 여러 곳을 연속으로 가릴 수 있습니다" onClick={() => openTab(sideTab === 'regions' ? 'stickers' : 'regions')}>
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.4 1.8"><ellipse cx="8" cy="8" rx="6.5" ry="5.5" /></svg><span className="label"> 블러·모자이크</span><span className="label-short"> 블러</span>
        </button>
        <button className="text-toggle" aria-label="글자 넣기" disabled={busy || !photo} title="글자 넣기 (T) — 사진 가운데에 글자를 추가합니다" onClick={() => void addTextItem()}>
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M3 3.5h10M8 3.5v10"/></svg><span className="label"> 글자</span>
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
      <button className="primary" onClick={saveNext} disabled={!canSave} title={`${output.format === 'jpg' ? 'JPG' : 'PNG'}로 저장하고 다음 사진으로 · 이동 없이 저장은 Ctrl+S`}>{busy ? '처리 중…' : '저장하고 다음'}</button>
      </div>
    </header>
    <div className="gif-host" hidden={mode !== 'gif'}>
      <GifMaker incoming={incomingVideo} outputFolder={outputFolder} active={mode === 'gif'} onBusyChange={setGifBusy}
        onSaved={receipt => setOutputFolder(receipt.folderLabel)} onStatus={showStatus} onError={showError} />
    </div>
    <section className="workspace" hidden={mode === 'gif'}>
      <div className="canvas-column">
        {mode === 'thumb' ? (photo ? <EditorCanvas key={photo.id} photo={photo} assets={assets.current} scene={scene} disabled={busy} onChange={(id, value) => change(value, id)} selectionTools={editTools}
          onSelect={selectFromCanvas} info={<>썸네일 · {THUMB_SIZE} × {THUMB_SIZE} px · {thumbFormat === 'jpg' ? 'JPG' : 'PNG'} · <b className={dirty ? 'dirty' : ''}>{dirty ? '수정됨' : sessions.current.get(THUMB)?.saved ? '저장됨' : '새 썸네일'}</b></>} />
          : <div className="empty"><span>썸네일을 준비하는 중…</span></div>)
        : photo ? <EditorCanvas key={photo.id} photo={photo} assets={assets.current} scene={scene} disabled={busy} onChange={(id, value) => change(value, id)} selectionTools={editTools}
          drawMode={drawMode} drawShape={regionDefaults.shape} onDraw={drawRegion} onSelect={selectFromCanvas}
          crop={scene.crop} cropEdit={cropMode && cropDraft?.photoId === photo.id ? { rect: cropDraft.crop, ratio: aspectRatio(cropDraft.crop.aspect, photo), onChange: changeCropRect } : undefined}
          info={(() => {
            const area = cropArea(cropMode && cropDraft ? cropDraft.crop : scene.crop, photo), cut = area.width !== photo.width || area.height !== photo.height
            return <>{photo.name} · {photo.width} × {photo.height} px{cut ? ` → 자르기 ${area.width} × ${area.height}` : ''}{outputLabel && outputLabel !== `${area.width} × ${area.height} px` ? ` → ${outputLabel}` : ''} · <b className={dirty || cropPending ? 'dirty' : ''}>{dirty || cropPending ? '수정됨' : '원본 / 저장됨'}</b></>
          })()} />
          : <div className="empty"><div className="drop-target"><strong>사진을 이 창으로 끌어다 놓으세요</strong><span>탐색기에서 JPG·PNG·HEIC 사진 여러 장이나 폴더를 한 번에 끌어 놓으면 바로 불러옵니다.</span><span>또는 위의 <b>사진 열기</b> · <b>폴더 열기</b></span></div></div>}
      </div>
      <aside>
        {mode === 'thumb' ? <>
        <div className="side-tabs" role="tablist" aria-label="썸네일 패널">
          <button role="tab" aria-selected={thumbTab === 'template'} onClick={() => setThumbTab('template')}>템플릿</button>
          <button role="tab" aria-selected={thumbTab === 'background'} onClick={() => setThumbTab('background')}>배경</button>
          <button role="tab" aria-selected={thumbTab === 'text'} onClick={() => setThumbTab('text')}>글자{!!scene.texts.length && <span className="tab-count">{scene.texts.length}</span>}</button>
          <button role="tab" aria-selected={thumbTab === 'deco'} onClick={() => setThumbTab('deco')}>꾸미기</button>
        </div>
        {thumbTab === 'template' ? <TemplateGallery filter={templateFilter} onFilter={setTemplateFilter} theme={scene.theme} current={scene.template} photo={thumbPhoto && scene.background?.photoId ? thumbPhoto : null}
          busy={busy} mine={myTemplates} maxMine={MAX_MY_TEMPLATES} onApply={template => void applyThumbTemplate(template)} onTheme={chooseTheme}
          onSaveMine={() => void saveMyTemplate()} onApplyMine={template => void applyMyTemplate(template)} onDeleteMine={id => storeMyTemplates(myTemplates.filter(item => item.id !== id))} />
        : thumbTab === 'background' ? <BackgroundPanel background={scene.background ?? DEFAULT_BACKGROUND} photos={photos} busy={busy} onChange={changeBackground} onCommit={commitLive} onOpenPhoto={() => void openThumbPhoto()} onRemovePhoto={removePhoto} />
        : thumbTab === 'text' ? textPanel
        : <>
          <ShapePanel shape={shapeItem} count={scene.shapes.length} busy={busy} onAdd={addShapeItem} onStyle={changeShapeStyle} onCommit={commitLive}>{shapeItem ? numericFields : null}</ShapePanel>
          <div className={`library-pane${dragging === 'stickers' ? ' drop-here' : ''}`} hidden={libraryOpen}><LibraryPanel {...libraryProps} mode="pick" onManage={() => setLibraryOpen(true)} /></div>
        </>}
        </> : <>
        <div className="side-tabs" role="tablist" aria-label="편집 패널">
          <button role="tab" aria-selected={sideTab === 'stickers'} onClick={() => openTab('stickers')}>스티커</button>
          <button role="tab" aria-selected={sideTab === 'regions'} onClick={() => openTab('regions')}>가림{!!scene.regions.length && <span className="tab-count">{scene.regions.length}</span>}</button>
          <button role="tab" aria-selected={sideTab === 'text'} onClick={() => openTab('text')}>글자{!!scene.texts.length && <span className="tab-count">{scene.texts.length}</span>}</button>
          <button role="tab" aria-selected={sideTab === 'adjust'} onClick={() => openTab('adjust')}>보정{!isNeutral(scene.adjust) && <span className="tab-dot" aria-label="(적용됨)" />}</button>
          <button role="tab" aria-selected={sideTab === 'crop'} title="자르기 (C)" onClick={() => openTab('crop')}>자르기{!!scene.crop && <span className="tab-dot" aria-label="(적용됨)" />}</button>
        </div>
        {sideTab === 'regions' ? <section className="region-panel" aria-label="블러·모자이크">
          <div className="region-fields" role="group" aria-label="가림 효과">
            <div className="field-row"><span>모양</span><div className="segmented" role="radiogroup" aria-label="가림 모양">
              {(['ellipse', 'rect'] as RegionShape[]).map(shape => <button key={shape} role="radio" aria-checked={effect.shape === shape} disabled={busy}
                onClick={() => changeRegionEffect({ ...effect, shape })}>{shape === 'ellipse' ? '◯ 원형' : '▭ 사각형'}</button>)}
            </div></div>
            <div className="field-row"><span>방식</span><div className="segmented" role="radiogroup" aria-label="가림 방식">
              {(['blur', 'mosaic'] as RegionStyle[]).map(style => <button key={style} role="radio" aria-checked={effect.style === style} disabled={busy}
                onClick={() => changeRegionEffect({ ...effect, style })}>{style === 'blur' ? '블러' : '모자이크'}</button>)}
            </div></div>
            <label>강도
              <input type="range" aria-label="가림 강도 슬라이더" min="1" max="100" step="1" disabled={busy} value={effect.strength}
                onChange={e => changeRegionEffect({ ...effect, strength: e.target.valueAsNumber }, true)}
                onPointerUp={commitLive} onKeyUp={commitLive} onBlur={commitLive} />
              <input type="number" aria-label="가림 강도" min="1" max="100" step="1" disabled={busy} value={effect.strength}
                onChange={e => changeRegionEffect({ ...effect, strength: e.target.valueAsNumber })} />
            </label>
            <p className="hint" data-testid="region-target">{region ? '선택한 영역에 적용됩니다.' : '다음에 그릴 영역에 적용됩니다.'}</p>
          </div>
          <div className="pane-heading">
            <h2>이 사진의 가림 <small><span data-testid="region-count">{scene.regions.length}</span>/50</small></h2>
            <button className="link" disabled={busy || !scene.regions.length} onClick={() => editScene(clearRegions(currentHistory.current.present))}>모두 지우기</button>
          </div>
          {!!scene.regions.length && <div className="instance-list" aria-label="가림 목록">
            {scene.regions.map((item, index) => <button key={item.id} className="region-chip" disabled={busy}
              aria-label={`가림 ${index + 1}: ${item.style === 'blur' ? '블러' : '모자이크'}`} aria-pressed={scene.selectedId === item.id}
              onClick={() => selectInstance(item.id)}>{item.shape === 'rect' ? '▭' : '◯'} {item.style === 'blur' ? '블러' : '모자이크'} {index + 1}</button>)}
          </div>}
          {region ? numericFields : <p className="hint">{photo ? '켜 둔 채로 여러 곳을 연속으로 가릴 수 있습니다. 빈 곳을 드래그하면 새 영역, 영역을 누르면 선택됩니다. Shift는 정원·정사각형, 사진 밖에서 드래그를 시작하면 사진 끝에 딱 맞춰집니다. Esc나 B로 도구를 끕니다.' : '사진을 열면 블러·모자이크로 가릴 수 있습니다.'}</p>}
        </section> : sideTab === 'crop' ? (() => {
          const aspect = cropDraft?.crop.aspect, orientable = !!aspect && hasOrientation(aspect)
          return <section className="crop-panel" aria-label="자르기">
            <div className="crop-presets" role="radiogroup" aria-label="자르기 비율">
              {CROP_PRESETS.map(base => {
                const label = CROP_LABELS[orient(base, cropPortrait)]
                return <button key={base} role="radio" aria-checked={!!aspect && orient(aspect, false) === base} disabled={busy || !cropDraft} title={`${label.name} · ${label.use}`}
                  onClick={() => chooseCropAspect(base)}><b>{label.name}</b><small>{label.use}</small></button>
              })}
            </div>
            <div className="field-row"><span>방향</span><div className="segmented" role="radiogroup" aria-label="자르기 방향">
              <button role="radio" aria-checked={!cropPortrait} disabled={busy || !orientable} onClick={() => chooseCropOrientation(false)}>▭ 가로</button>
              <button role="radio" aria-checked={cropPortrait} disabled={busy || !orientable} onClick={() => chooseCropOrientation(true)}>▯ 세로</button>
            </div></div>
            <p className="crop-size">자를 크기 <strong data-testid="crop-size" data-x={cropDraft?.crop.x} data-y={cropDraft?.crop.y}>{cropDraft ? `${cropDraft.crop.width} × ${cropDraft.crop.height} px` : '-'}</strong></p>
            <div className="crop-actions">
              <button className="primary" disabled={busy || !cropDraft} title="Enter" onClick={finishCrop}>완료</button>
              <button disabled={busy || !cropDraft} title="Esc — 이 탭을 열기 전 범위로" onClick={cancelCrop}>취소</button>
              <button disabled={busy || !cropDraft || (cropDraft.crop.width === cropDraft.width && cropDraft.crop.height === cropDraft.height)} title="자르지 않은 원본 전체로" onClick={resetCrop}>원래대로</button>
              <button disabled={busy || !cropDraft || photos.length < 2 || !aspect || aspect === 'free' || aspect === 'original'}
                title="다른 사진을 같은 비율로 가운데를 자릅니다 (세로 사진은 세로 비율로)" onClick={applyCropToAll}>모든 사진에 이 비율</button>
            </div>
            <p className="hint">{photo ? '모서리를 끌면 크기, 안쪽을 끌면 위치가 바뀝니다. 방향키 1px, Shift+방향키 10px 이동 · Enter 완료 · Esc 취소. 잘린 부분은 원본에 남아 있어 언제든 다시 넓힐 수 있습니다.' : '사진을 열면 자를 수 있습니다.'}</p>
          </section>
        })() : sideTab === 'text' ? textPanel : sideTab === 'adjust' ? <section className="adjust-panel" aria-label="사진 보정">
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
            <h2>올린 스티커 <small><span data-testid="instance-count">{scene.stickers.length}</span></small></h2>
            <button className="link" disabled={busy || !(referencedAssetsForCurrent.length || scene.regions.length || scene.texts.length || history.past.length || history.future.length)} onClick={clearScene}>배치·이력 비우기</button>
          </div>
          {!!scene.stickers.length && <div className="instance-list" aria-label="사진의 스티커 목록">
            {scene.stickers.map((item, index) => <button key={item.id} disabled={busy}
              aria-label={`배치 ${index + 1}: ${assets.current.get(item.assetId)?.name ?? '스티커'}`} aria-pressed={scene.selectedId === item.id}
              onClick={() => selectInstance(item.id)}>{index + 1}. {assets.current.get(item.assetId)?.name ?? '스티커'}</button>)}
          </div>}
          {placement ? numericFields : <p className="hint">스티커를 클릭하면 사진 위에 복제·순서·삭제 버튼이 나타납니다. 방향키 1px, Shift+방향키 10px 이동.</p>}
        </section>}
        </>}
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
    <footer className="statusbar"><p role="status" aria-live="polite">{status || (mode === 'photo' && photo ? <span className="shortcuts">Ctrl+S 저장 · Ctrl+Z 실행 취소 · Ctrl+D 복제 · Delete 삭제 · B 블러·모자이크 · T 글자 · C 자르기 · Ctrl+휠 확대</span>
  : mode === 'thumb' ? <span className="shortcuts">Ctrl+S 썸네일 저장 · Ctrl+Z 실행 취소 · Ctrl+D 복제 · Delete 삭제 · T 글자</span> : '')}</p>{error && !libraryOpen && !pendingPhoto && <p role="alert">{error}</p>}
      <div className="update-area" role="group" aria-label="업데이트">
        {update?.status === 'available' && dismissedUpdate !== update.version && <>
          <span className="update-note">새 버전 {update.version}</span>
          <button className="primary small" onClick={() => void updateAction('download')}>업데이트</button>
          <button className="link" onClick={() => setDismissedUpdate(update.version ?? null)}>나중에</button>
        </>}
        {update?.status === 'downloading' && <span className="update-note">새 버전 {update.version} 내려받는 중 <progress max={100} value={update.percent ?? 0} aria-label="업데이트 내려받는 중" /> {update.percent ?? 0}%</span>}
        {update?.status === 'ready' && <>
          <span className="update-note">새 버전 {update.version} 준비됨</span>
          <button className="primary small" title="저장하지 않은 편집이 있으면 먼저 저장 여부를 묻습니다" onClick={() => void updateAction('install')}>다시 시작해서 설치</button>
        </>}
        {update?.status === 'error' && <>
          <span className="update-note error">{update.message}</span>
          <button className="small" onClick={() => void updateAction('download')}>다시 시도</button>
        </>}
        {update && <button className="link version" disabled={update.status === 'unsupported' || update.status === 'downloading'}
          title={update.status === 'unsupported' ? '설치한 Windows 앱에서만 업데이트를 확인합니다' : '업데이트 확인'} onClick={() => void updateAction('check')}>v{update.current}</button>}
      </div>
    </footer>
  </main>
}
createRoot(document.getElementById('root')!).render(<App />)
