import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BUNDLED_FONTS, CATEGORY_LABELS, systemFamily, systemFont, type FontCategory } from '../shared/fonts'
import type { LibrarySticker } from '../shared/library'
import { STICKER_ICONS } from '../shared/sticker-icons'
import {
  DEFAULT_MAKER, KIND_CATEGORIES, KIND_LABELS, MAX_BODY_LINES, MAX_CAPTION, MAX_LINE, MAX_MAKER_ITEMS, MAX_MY_STICKERS, MAX_TITLE, PHRASES, STICKER_ACCENTS,
  STICKER_DESIGNS, STICKER_SIZES, designById, phraseContent, plainText, stickerName, validMakerState, validMyStickers,
  type MakerItem, type MakerState, type MySticker, type Phrase, type StickerContent, type StickerKind, type StickerSpec, type StickerStyle
} from '../shared/sticker-maker'
import { loadPref, savePref } from './remember'
import { renderSticker, stickerPng } from './sticker-draw'
import { ensureFont, listSystemFonts, previewFamily } from './text'
import { ColorField } from './TextPanel'

interface Props {
  active: boolean
  outputFolder: string | null
  onSaved(folderLabel: string): void
  onLibrary(stickers: LibrarySticker[]): void
  onStatus(text: string): void
  onError(text: string): void
  onBusyChange(busy: boolean): void
}
type Tab = 'design' | 'phrase' | 'content' | 'style'
type Gallery = StickerKind | 'mine'
const KINDS: StickerKind[] = ['notice', 'heading', 'end']
const STATE_KEY = 'pk.maker', MINE_KEY = 'pk.makerMine'
let myIds = 0
const newId = () => `${Date.now().toString(36)}-${++myIds}`

/** Loads the faces a sticker uses (regular for body text, bold for titles) before it is measured. */
const fontsFor = (style: StickerStyle) => Promise.all([ensureFont(style.font, false), ensureFont(style.font, true)])
/** Draws a rendered sticker scaled into a small card canvas. */
function useCardPreview(spec: StickerSpec, width: number, height: number) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const key = JSON.stringify(spec)
  useEffect(() => {
    let alive = true
    const timer = setTimeout(() => {
      void fontsFor(spec.style).then(() => {
        const node = canvas.current, context = node?.getContext('2d')
        if (!alive || !node || !context) return
        const ratio = window.devicePixelRatio || 1
        node.width = Math.round(width * ratio); node.height = Math.round(height * ratio)
        context.clearRect(0, 0, node.width, node.height)
        let sticker: HTMLCanvasElement | null = null
        try { sticker = renderSticker({ ...spec, style: { ...spec.style, size: 20 } }) } catch { /* too big: the card stays empty */ }
        if (!sticker) return
        const scale = Math.min(node.width * 0.9 / sticker.width, node.height * 0.86 / sticker.height, ratio * 1.2)
        const w = sticker.width * scale, h = sticker.height * scale
        context.drawImage(sticker, (node.width - w) / 2, (node.height - h) / 2, w, h)
      }).catch(() => undefined)
    }, 120)
    return () => { alive = false; clearTimeout(timer) }
  }, [key, width, height])
  return canvas
}
function DesignCard({ spec, label, current, disabled, onClick }: { spec: StickerSpec; label: string; current: boolean; disabled: boolean; onClick(): void }) {
  const canvas = useCardPreview(spec, 124, 76)
  return <button className="maker-card" aria-pressed={current} disabled={disabled} aria-label={label} title={label} onClick={onClick}>
    <canvas ref={canvas} width={124} height={76} aria-hidden="true" />
  </button>
}
function IconGlyph({ d, size = 18 }: { d: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
}

export function StickerMaker({ active, outputFolder, onSaved, onLibrary, onStatus, onError, onBusyChange }: Props) {
  const api = window.photokkumi
  const [state, setState] = useState<MakerState>(() => loadPref(STATE_KEY, DEFAULT_MAKER, validMakerState))
  const [mine, setMine] = useState<MySticker[]>(() => loadPref(MINE_KEY, [], validMyStickers))
  const [tab, setTab] = useState<Tab>('design')
  const [gallery, setGallery] = useState<Gallery>(() => designById(state.design)?.kind ?? 'notice')
  const [backdrop, setBackdrop] = useState<'checker' | 'white' | 'dark'>('white')
  const [work, setWork] = useState<'save' | 'library' | null>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const [renderError, setRenderError] = useState('')
  const [systemFonts, setSystemFonts] = useState<string[] | null>(null)
  const [batch, setBatch] = useState<Set<string>>(new Set())
  const batchDialog = useRef<HTMLDialogElement>(null)
  const preview = useRef<HTMLCanvasElement>(null)
  const busy = work !== null
  useEffect(() => { onBusyChange(busy) }, [busy, onBusyChange])
  useEffect(() => { savePref(STATE_KEY, state) }, [state])
  useEffect(() => { if (tab === 'style' && systemFonts === null) void listSystemFonts().then(setSystemFonts) }, [tab, systemFonts])

  const design = designById(state.design) ?? STICKER_DESIGNS[0]
  const kind = design.kind
  const content = state.contents[kind]
  const spec: StickerSpec = useMemo(() => ({ design: design.id, content, style: state.style }), [design.id, content, state.style])
  const fields = new Set(design.fields)

  // Live preview at the real output size.
  useEffect(() => {
    let alive = true
    void fontsFor(spec.style).then(() => {
      if (!alive) return
      const node = preview.current, context = node?.getContext('2d')
      if (!node || !context) return
      try {
        const sticker = renderSticker(spec)
        setRenderError('')
        if (!sticker) { node.width = node.height = 1; context.clearRect(0, 0, 1, 1); setSize(null); return }
        node.width = sticker.width; node.height = sticker.height
        context.clearRect(0, 0, node.width, node.height)
        context.drawImage(sticker, 0, 0)
        setSize({ width: sticker.width, height: sticker.height })
      } catch (error) { setRenderError(error instanceof Error ? error.message : '스티커를 그리지 못했습니다.'); setSize(null) }
    }).catch(() => undefined)
    return () => { alive = false }
  }, [spec])

  const setContent = (patch: Partial<StickerContent>, target: StickerKind = kind) =>
    setState(current => ({ ...current, contents: { ...current.contents, [target]: { ...current.contents[target], ...patch } } }))
  const setStyle = (patch: Partial<StickerStyle>) => setState(current => ({ ...current, style: { ...current.style, ...patch } }))
  const chooseDesign = (id: string) => setState(current => ({ ...current, design: id }))
  const applyPhrase = (phrase: Phrase) => {
    // Keep the user's design when it fits the phrase; otherwise jump to the first design of that kind.
    setState(current => ({ ...current, design: designById(current.design)?.kind === phrase.kind ? current.design : STICKER_DESIGNS.find(item => item.kind === phrase.kind)!.id,
      contents: { ...current.contents, [phrase.kind]: phraseContent(phrase) } }))
  }

  const act = useCallback(async (kindOfWork: 'save' | 'library', action: () => Promise<void>) => {
    setWork(kindOfWork); onError('')
    try { await action() }
    catch (error) { onError(error instanceof Error ? error.message : '스티커를 저장하지 못했습니다.') }
    finally { setWork(null) }
  }, [onError])
  const makeItems = async (specs: { spec: StickerSpec; name: string }[]): Promise<MakerItem[]> => {
    await Promise.all([...new Set(specs.map(item => JSON.stringify(item.spec.style)))].map(style => fontsFor(JSON.parse(style) as StickerStyle)))
    const items: MakerItem[] = []
    for (const item of specs) {
      const canvas = renderSticker(item.spec)
      if (canvas) items.push({ name: item.name, png: await stickerPng(canvas) })
    }
    if (!items.length) throw new Error('그릴 내용이 없습니다. 글자를 입력해 주세요.')
    return items
  }
  const unwrap = <T,>(result: { ok: true; value: T } | { ok: false; error: string }): T => { if (!result.ok) throw new Error(result.error); return result.value }
  const saveFiles = (specs: { spec: StickerSpec; name: string }[]) => act('save', async () => {
    const items = await makeItems(specs)
    const receipt = unwrap(await api.saveMakerStickers({ items, category: KIND_CATEGORIES[designById(specs[0].spec.design)!.kind] }))
    if (!receipt) { onStatus('저장이 취소되었습니다.'); return }
    onSaved(receipt.folderLabel)
    onStatus(receipt.names.length === 1 ? `스티커 저장 완료 · ${receipt.names[0]}` : `스티커 ${receipt.names.length}개 저장 완료 · ${receipt.names[0]} 외`)
  })
  const addToLibrary = (specs: { spec: StickerSpec; name: string }[]) => act('library', async () => {
    const items = await makeItems(specs)
    const category = KIND_CATEGORIES[designById(specs[0].spec.design)!.kind]
    const result = unwrap(await api.addMakerStickers({ items, category }))
    onLibrary(result.stickers)
    onStatus(`스티커 라이브러리 '${category}' 분류에 ${items.length === 1 ? '추가했습니다' : `${items.length}개를 추가했습니다`} · 사진 편집·썸네일의 스티커 목록에서 바로 쓸 수 있어요 (같은 그림은 한 번만 들어갑니다).`)
  })
  const current = [{ spec, name: stickerName(spec) }]
  const saveCurrent = () => { if (!busy && size) void saveFiles(current) }
  const saveShortcut = useRef(saveCurrent)
  saveShortcut.current = saveCurrent
  useEffect(() => {
    if (!active) return
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 's' || event.repeat) return
      if (document.querySelector('dialog[open]')) return
      event.preventDefault(); saveShortcut.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])

  const storeMine = (next: MySticker[]) => { setMine(next); savePref(MINE_KEY, next) }
  const saveMine = () => {
    if (mine.length >= MAX_MY_STICKERS) return
    storeMine([{ id: newId(), ...structuredClone(spec) }, ...mine])
    setGallery('mine'); onStatus('내 스티커에 저장했습니다. 다음에 업체명만 바꿔 다시 쓰세요.')
  }
  const applyMine = (item: MySticker) => {
    const target = designById(item.design)!.kind
    setState(current => ({ design: item.design, style: item.style, contents: { ...current.contents, [target]: item.content } }))
  }

  const phrases = PHRASES.filter(item => item.kind === kind)
  const openBatch = () => { setBatch(new Set(phrases.map(item => item.id))); batchDialog.current?.showModal() }
  const batchSpecs = () => phrases.filter(item => batch.has(item.id)).slice(0, MAX_MAKER_ITEMS)
    .map(item => ({ spec: { ...spec, content: phraseContent(item) }, name: plainText(item.title).trim() || '스티커' }))
  const runBatch = (action: typeof saveFiles) => { const specs = batchSpecs(); if (!specs.length) return; batchDialog.current?.close(); void action(specs) }

  const family = systemFamily(state.style.font)
  const pcFonts = systemFonts ?? []
  const listedFonts = family === null || pcFonts.includes(family) ? pcFonts : [family, ...pcFonts]
  const bodyLineCount = content.body.split('\n').length

  return <div className="maker-workspace" aria-label="스티커 만들기">
    <div className="maker-main">
      <div className={`maker-preview ${backdrop}`} data-testid="maker-preview">
        <canvas ref={preview} width={1} height={1} aria-label="스티커 미리보기" hidden={!size} />
        {!size && <p className="hint">{renderError || '내용을 입력하면 여기에 스티커가 보입니다.'}</p>}
      </div>
      <div className="view-tools">
        <span className="hint">미리보기 바탕</span>
        {([['white', '흰색'], ['checker', '투명'], ['dark', '어두운 색']] as const).map(([value, label]) =>
          <button key={value} aria-pressed={backdrop === value} onClick={() => setBackdrop(value)}>{label}</button>)}
        <span className="canvas-info" data-testid="maker-size">{size ? `${size.width} × ${size.height} px · 투명 PNG · 실제 크기` : ''}</span>
      </div>
    </div>
    <aside className="maker-side">
      <div className="side-tabs" role="tablist" aria-label="스티커 만들기 패널">
        <button role="tab" aria-selected={tab === 'design'} onClick={() => setTab('design')}>디자인</button>
        <button role="tab" aria-selected={tab === 'phrase'} onClick={() => setTab('phrase')}>문구</button>
        <button role="tab" aria-selected={tab === 'content'} onClick={() => setTab('content')}>내용</button>
        <button role="tab" aria-selected={tab === 'style'} onClick={() => setTab('style')}>스타일</button>
      </div>
      {tab === 'design' ? <section className="maker-panel" aria-label="디자인">
        <div className="segmented four" role="radiogroup" aria-label="스티커 종류">
          {([...KINDS, 'mine'] as Gallery[]).map(item => <button key={item} role="radio" aria-checked={gallery === item} onClick={() => setGallery(item)}>
            {item === 'mine' ? '내 스티커' : item === 'notice' ? '공정위' : KIND_LABELS[item]}</button>)}
        </div>
        {gallery === 'mine' ? <div className="maker-grid" aria-label="내 스티커">
          <button className="maker-card save" disabled={busy || !size || mine.length >= MAX_MY_STICKERS} onClick={saveMine}
            title={mine.length >= MAX_MY_STICKERS ? `내 스티커는 ${MAX_MY_STICKERS}개까지 저장됩니다` : '지금 디자인·내용·색을 저장'}>＋<span>지금 스티커 저장</span></button>
          {mine.map((item, index) => <div key={item.id} className="my-template">
            <DesignCard spec={item} label={`내 스티커 ${index + 1}: ${stickerName(item)}`} current={false} disabled={busy} onClick={() => applyMine(item)} />
            <button className="remove" disabled={busy} aria-label={`내 스티커 ${index + 1} 삭제`} title="내 스티커 삭제" onClick={() => storeMine(mine.filter(entry => entry.id !== item.id))}>×</button>
          </div>)}
        </div> : <div className="maker-grid" aria-label={`${KIND_LABELS[gallery]} 디자인`}>
          {STICKER_DESIGNS.filter(item => item.kind === gallery).map(item => <DesignCard key={item.id} spec={{ design: item.id, content: state.contents[item.kind], style: state.style }}
            label={`디자인: ${item.name}`} current={item.id === design.id} disabled={busy} onClick={() => chooseDesign(item.id)} />)}
        </div>}
        <p className="hint">{gallery === 'mine' ? '자주 쓰는 스티커를 저장해 두고 내용만 바꿔 쓰세요.' : `${KIND_LABELS[gallery]} 디자인 ${STICKER_DESIGNS.filter(item => item.kind === gallery).length}종 · 문구 탭에서 자주 쓰는 문장을 고를 수 있어요.`}</p>
      </section>
      : tab === 'phrase' ? <section className="maker-panel" aria-label="문구">
        <div className="segmented three" role="radiogroup" aria-label="문구 종류">
          {KINDS.map(item => <button key={item} role="radio" aria-checked={kind === item} disabled={busy}
            onClick={() => { if (item !== kind) { chooseDesign(STICKER_DESIGNS.find(entry => entry.kind === item)!.id); setGallery(item) } }}>{item === 'notice' ? '공정위' : KIND_LABELS[item]}</button>)}
        </div>
        <p className="hint">누르면 지금 디자인({design.name})에 문구가 들어갑니다. 내용 탭에서 업체명 등을 고치세요.</p>
        <div className="phrase-list" aria-label={`${KIND_LABELS[kind]} 문구`}>
          {phrases.map(item => <button key={item.id} className="phrase" disabled={busy} onClick={() => applyPhrase(item)}
            aria-pressed={content.title === item.title && content.body === (item.body ?? '') && content.caption === (item.caption ?? '')}>
            <IconGlyph d={STICKER_ICONS.find(icon => icon.id === item.icon)?.d ?? ''} size={16} />
            <span><b>{plainText(item.title)}</b>{(item.body || item.caption) && <small>{plainText((item.body ?? item.caption ?? '').split('\n').join(' '))}</small>}</span>
          </button>)}
        </div>
      </section>
      : tab === 'content' ? <section className="maker-panel maker-fields" aria-label="내용">
        <p className="hint"><b>{KIND_LABELS[kind]} · {design.name}</b> · <b>[ ]</b>로 감싼 글자는 강조됩니다.</p>
        {fields.has('title') && <label>{kind === 'notice' ? '머리말' : '제목'}
          <input aria-label="스티커 제목" maxLength={MAX_TITLE} value={content.title} disabled={busy} onChange={e => setContent({ title: e.target.value })} /></label>}
        {fields.has('body') && <label><span className="field-head">문장 <small>{bodyLineCount}/{MAX_BODY_LINES}줄 · 한 줄 {MAX_LINE}자까지</small></span>
          <textarea aria-label="스티커 문장" rows={4} spellCheck={false} value={content.body} disabled={busy}
            onChange={e => { const lines = e.target.value.split('\n'); if (lines.length <= MAX_BODY_LINES && lines.every(item => item.length <= MAX_LINE)) setContent({ body: e.target.value }) }} /></label>}
        {fields.has('caption') && <label>작은 글
          <input aria-label="스티커 작은 글" maxLength={MAX_CAPTION} value={content.caption} disabled={busy} onChange={e => setContent({ caption: e.target.value })} /></label>}
        {fields.has('icon') && <div className="maker-icons" role="radiogroup" aria-label="아이콘">
          <button role="radio" aria-checked={!content.icon} title="아이콘 없음" aria-label="아이콘 없음" disabled={busy} onClick={() => setContent({ icon: '' })}>없음</button>
          {STICKER_ICONS.map(icon => <button key={icon.id} role="radio" aria-checked={content.icon === icon.id} title={icon.name} aria-label={`아이콘: ${icon.name}`} disabled={busy}
            onClick={() => setContent({ icon: icon.id })}><IconGlyph d={icon.d} /></button>)}
        </div>}
        {!fields.has('body') && kind === 'notice' && <p className="hint">작은 배지는 머리말만 씁니다(예: 광고, 협찬, 내돈내산).</p>}
      </section>
      : <section className="maker-panel maker-fields" aria-label="스타일">
        <div className="maker-swatches" role="radiogroup" aria-label="강조색">
          {STICKER_ACCENTS.map(item => <button key={item.color} role="radio" className="swatch" aria-checked={state.style.accent === item.color} aria-label={`강조색: ${item.name}`} title={item.name}
            style={{ background: item.color }} disabled={busy} onClick={() => setStyle({ accent: item.color })} />)}
        </div>
        <div className="field-row"><span>강조색</span><ColorField label="강조색 직접 고르기" value={state.style.accent} disabled={busy} onLive={accent => setStyle({ accent })} onCommit={() => undefined} />
          <span>글자색</span><ColorField label="글자색" value={state.style.ink} disabled={busy} onLive={ink => setStyle({ ink })} onCommit={() => undefined} /></div>
        <label>글꼴<select aria-label="스티커 글꼴" disabled={busy} value={state.style.font} style={{ fontFamily: previewFamily(state.style.font) }} onChange={e => setStyle({ font: e.target.value })}>
          {(Object.keys(CATEGORY_LABELS) as FontCategory[]).map(category => <optgroup key={category} label={`앱 글꼴 · ${CATEGORY_LABELS[category]}`}>
            {BUNDLED_FONTS.filter(font => font.category === category).map(font => <option key={font.id} value={font.id}>{font.name}</option>)}
          </optgroup>)}
          <optgroup label={systemFonts === null ? '내 PC 글꼴 (불러오는 중…)' : `내 PC 글꼴 ${pcFonts.length}개`}>
            {listedFonts.map(name => <option key={name} value={systemFont(name)}>{name}</option>)}
          </optgroup>
        </select></label>
        <div className="segmented four" role="radiogroup" aria-label="스티커 크기">
          {STICKER_SIZES.map(item => <button key={item.size} role="radio" aria-checked={state.style.size === item.size} title={`본문 글자 ${item.size}px`} disabled={busy}
            onClick={() => setStyle({ size: item.size })}>{item.name}</button>)}
        </div>
        <p className="hint">크기는 문장 글자 기준입니다(작게 18px · 보통 24px · 크게 32px · 아주 크게 44px). 블로그 본문에는 보통이나 크게가 잘 맞아요.</p>
      </section>}
      <div className="maker-footer">
        <div className="gif-output"><span>출력 폴더</span><span className="folder-name" title={outputFolder ?? undefined}>{outputFolder ?? '미지정 · 저장 시 선택'}</span></div>
        <button className="primary maker-save" disabled={busy || !size} onClick={saveCurrent} title="투명 PNG로 출력 폴더에 저장 (Ctrl+S)">{work === 'save' ? '저장 중…' : 'PNG로 저장'}</button>
        <div className="maker-actions">
          <button disabled={busy || !size} onClick={() => void addToLibrary(current)} title={`스티커 라이브러리의 '${KIND_CATEGORIES[kind]}' 분류에 추가`}>{work === 'library' ? '추가 중…' : '라이브러리에 추가'}</button>
          <button disabled={busy} onClick={openBatch} title="지금 디자인으로 여러 문구를 한 번에 만듭니다">여러 문구 한 번에…</button>
        </div>
      </div>
    </aside>
    <dialog ref={batchDialog} className="maker-batch" aria-labelledby="maker-batch-title">
      <h2 id="maker-batch-title">여러 문구 한 번에 만들기</h2>
      <p className="hint">지금 디자인(<b>{design.name}</b>)과 색·글꼴·크기로, 고른 {KIND_LABELS[kind]} 문구를 하나씩 PNG로 만듭니다.</p>
      <div className="batch-head">
        <label className="check"><input type="checkbox" checked={batch.size === phrases.length} onChange={e => setBatch(e.target.checked ? new Set(phrases.map(item => item.id)) : new Set())} />모두 선택</label>
        <span className="hint">{batch.size}개 선택</span>
      </div>
      <div className="batch-list">
        {phrases.map(item => <label key={item.id} className="check"><input type="checkbox" checked={batch.has(item.id)}
          onChange={e => setBatch(currentSet => { const next = new Set(currentSet); if (e.target.checked) next.add(item.id); else next.delete(item.id); return next })} />
          {plainText(item.title)}{item.caption ? <small> · {item.caption}</small> : null}</label>)}
      </div>
      <div className="close-actions">
        <button className="primary" disabled={!batch.size} onClick={() => runBatch(saveFiles)}>PNG {batch.size}개 저장</button>
        <button disabled={!batch.size} onClick={() => runBatch(addToLibrary)}>라이브러리에 {batch.size}개 추가</button>
        <button onClick={() => batchDialog.current?.close()}>닫기</button>
      </div>
    </dialog>
  </div>
}
