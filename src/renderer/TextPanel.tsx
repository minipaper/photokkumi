import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { BUNDLED_FONTS, CATEGORY_LABELS, systemFont, systemFamily, type FontCategory } from '../shared/fonts'
import { MAX_TEXTS, TEXT_PRESETS, type TextAlign, type TextItem, type TextStyle } from '../shared/text'
import { previewFamily } from './text'

interface Props {
  photoOpen: boolean
  busy: boolean
  texts: TextItem[]
  selected: TextItem | null
  /** Style shown in the panel: the selected text's, or the defaults for the next text. */
  style: TextStyle
  fontSize: number | null
  maxFontSize: number
  /** null while the PC font list is loading. */
  systemFonts: string[] | null
  textArea: RefObject<HTMLTextAreaElement | null>
  onAdd(): void
  onSelect(id: string): void
  onText(text: string): void
  onStyle(patch: Partial<TextStyle>, live?: boolean): void
  onFontSize(size: number, live?: boolean): void
  onCommit(): void
  onClear(): void
  children?: ReactNode
}
/** Native color inputs fire input events while the picker is open; the change event closes one undo step. */
function ColorField({ label, value, disabled, onLive, onCommit }: { label: string; value: string; disabled: boolean; onLive(value: string): void; onCommit(): void }) {
  const input = useRef<HTMLInputElement>(null)
  const commit = useRef(onCommit)
  commit.current = onCommit
  useEffect(() => {
    const node = input.current
    const done = () => commit.current()
    node?.addEventListener('change', done)
    return () => node?.removeEventListener('change', done)
  }, [])
  return <input ref={input} type="color" className="color" aria-label={label} title={label} disabled={disabled} value={value} onChange={e => onLive(e.target.value)} onBlur={onCommit} />
}
const ALIGN_LABELS: Record<TextAlign, string> = { left: '왼쪽', center: '가운데', right: '오른쪽' }
const alignIcon = (align: TextAlign) => <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
  {[3, 6.5, 10, 13.5].map((y, index) => { const long = index % 2 === 0, w = long ? 12 : 8, x = align === 'left' ? 2 : align === 'right' ? 14 - w : 8 - w / 2; return <path key={y} d={`M${x} ${y}h${w}`} /> })}
</svg>

export function TextPanel({ photoOpen, busy, texts, selected, style, fontSize, maxFontSize, systemFonts, textArea, onAdd, onSelect, onText, onStyle, onFontSize, onCommit, onClear, children }: Props) {
  const off = busy || !photoOpen
  const editing = !!selected
  const family = systemFamily(style.font)
  // A system font chosen earlier stays selectable even if the list has not loaded yet.
  const pcFonts = systemFonts ?? []
  const listed = family === null || pcFonts.includes(family) ? pcFonts : [family, ...pcFonts]
  const categories = Object.keys(CATEGORY_LABELS) as FontCategory[]
  return <section className="text-panel" aria-label="글자">
    <div className="text-add">
      <button className="primary" disabled={off || texts.length >= MAX_TEXTS} onClick={onAdd}>+ 글자 추가</button>
      <span className="hint">{editing ? '선택한 글자를 고칩니다' : photoOpen ? '스타일은 다음 글자에 적용' : '사진을 열면 글자를 넣을 수 있습니다'}</span>
    </div>
    <textarea ref={textArea} aria-label="글자 내용" rows={2} maxLength={500} placeholder={editing ? '' : '글자 추가를 누른 뒤 입력하세요'} disabled={off || !editing}
      value={selected?.text ?? ''} style={{ fontFamily: previewFamily(style.font), fontWeight: style.bold ? 700 : 400 }}
      onChange={e => onText(e.target.value)} onBlur={onCommit} />
    <div className="text-presets" role="group" aria-label="빠른 스타일">
      {TEXT_PRESETS.map(preset => {
        const look = { ...style, ...preset.style }
        // A photo-like backdrop shows how each look reads on a picture.
        return <button key={preset.name} className="preset" disabled={off} title={preset.name} aria-label={`스타일: ${preset.name}`}
          onClick={() => onStyle(preset.style)}>
          <span style={{ color: look.color, background: look.boxOpacity > 0 ? `${look.boxColor}${Math.round(look.boxOpacity * 2.55).toString(16).padStart(2, '0')}` : undefined,
            WebkitTextStroke: look.strokeWidth > 0 ? `${Math.max(2, look.strokeWidth / 4)}px ${look.strokeColor}` : undefined,
            textShadow: look.shadow ? '0 1px 3px rgba(0,0,0,.7)' : undefined }}>가</span>
        </button>
      })}
    </div>
    <div className="region-fields text-fields" role="group" aria-label="글자 스타일">
      <label>글꼴<select aria-label="글꼴" disabled={off} value={style.font} onChange={e => onStyle({ font: e.target.value })}>
        {categories.map(category => <optgroup key={category} label={`앱 글꼴 · ${CATEGORY_LABELS[category]}`}>
          {BUNDLED_FONTS.filter(font => font.category === category).map(font => <option key={font.id} value={font.id}>{font.name}</option>)}
        </optgroup>)}
        <optgroup label={systemFonts === null ? '내 PC 글꼴 (불러오는 중…)' : `내 PC 글꼴 ${pcFonts.length}개`}>
          {listed.map(name => <option key={name} value={systemFont(name)}>{name}</option>)}
        </optgroup>
      </select></label>
      <label>크기
        <input type="range" aria-label="글자 크기 슬라이더" min="8" max={maxFontSize} step="1" disabled={off || !editing} value={Math.round(fontSize ?? 8)}
          onChange={e => onFontSize(e.target.valueAsNumber, true)} onPointerUp={onCommit} onKeyUp={onCommit} onBlur={onCommit} />
        <input type="number" aria-label="글자 크기" min="4" max="4000" step="1" disabled={off || !editing} value={fontSize === null ? '' : Math.round(fontSize)}
          onChange={e => onFontSize(e.target.valueAsNumber)} />
      </label>
      <div className="field-row">
        <button className="icon bold-toggle" aria-label="굵게" title="굵게" aria-pressed={style.bold} disabled={off} onClick={() => onStyle({ bold: !style.bold })}><b>B</b></button>
        <div className="segmented three" role="radiogroup" aria-label="줄 정렬">
          {(['left', 'center', 'right'] as TextAlign[]).map(align => <button key={align} role="radio" aria-checked={style.align === align} aria-label={`${ALIGN_LABELS[align]} 정렬`} title={`${ALIGN_LABELS[align]} 정렬`} disabled={off}
            onClick={() => onStyle({ align })}>{alignIcon(align)}</button>)}
        </div>
        <button className="icon bold-toggle" aria-label="그림자" title="그림자" aria-pressed={style.shadow} disabled={off} onClick={() => onStyle({ shadow: !style.shadow })}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><text x="9.5" y="13.5" textAnchor="middle" fontSize="12" fontWeight="800" fill="currentColor" opacity=".3">S</text><text x="7.5" y="11.5" textAnchor="middle" fontSize="12" fontWeight="800" fill="currentColor">S</text></svg>
        </button>
        <span className="color-label">색</span>
        <ColorField label="글자색" value={style.color} disabled={off} onLive={color => onStyle({ color }, true)} onCommit={onCommit} />
      </div>
      <label title="외곽선 두께: 글자 크기의 %, 0이면 없음">외곽선
        <ColorField label="외곽선 색" value={style.strokeColor} disabled={off} onLive={strokeColor => onStyle({ strokeColor }, true)} onCommit={onCommit} />
        <input type="range" aria-label="외곽선 두께" min="0" max="30" step="1" disabled={off} value={style.strokeWidth}
          onChange={e => onStyle({ strokeWidth: e.target.valueAsNumber }, true)} onPointerUp={onCommit} onKeyUp={onCommit} onBlur={onCommit} />
        <span className="slider-value" aria-hidden="true">{style.strokeWidth}</span>
      </label>
      <label title="배경 상자 불투명도: 0이면 상자 없음">배경
        <ColorField label="배경 상자 색" value={style.boxColor} disabled={off} onLive={boxColor => onStyle({ boxColor }, true)} onCommit={onCommit} />
        <input type="range" aria-label="배경 불투명도" min="0" max="100" step="1" disabled={off} value={style.boxOpacity}
          onChange={e => onStyle({ boxOpacity: e.target.valueAsNumber }, true)} onPointerUp={onCommit} onKeyUp={onCommit} onBlur={onCommit} />
        <button className="icon bold-toggle" aria-label="둥근 상자" title="둥근 상자" aria-pressed={style.boxRound} disabled={off || style.boxOpacity === 0} onClick={() => onStyle({ boxRound: !style.boxRound })}>
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="2" y="4" width="12" height="8" rx="4" /></svg>
        </button>
      </label>
    </div>
    <div className="pane-heading">
      <h2>이 사진의 글자 <small><span data-testid="text-count">{texts.length}</span>/{MAX_TEXTS}</small></h2>
      <button className="link" disabled={busy || !texts.length} onClick={onClear}>모두 지우기</button>
    </div>
    {!!texts.length && <div className="instance-list" aria-label="글자 목록">
      {texts.map((item, index) => <button key={item.id} disabled={busy} aria-pressed={selected?.id === item.id}
        aria-label={`글자 ${index + 1}: ${item.text}`} onClick={() => onSelect(item.id)}>T {item.text.split('\n')[0].slice(0, 12) || '(빈 글자)'}</button>)}
    </div>}
    {children}
  </section>
}
