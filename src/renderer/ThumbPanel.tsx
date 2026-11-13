import { useEffect, useRef, type ReactNode } from 'react'
import { MAX_SHAPES, PALETTES, palette, validBackground, validShapeItem, type ShapeItem, type ShapeStyle, type ThumbBackground } from '../shared/shapes'
import { THUMB_TEMPLATES, type ThumbTemplate } from '../shared/thumb-templates'
import type { PhotoInfo } from '../shared/model'
import { MAX_TEXTS, validTextItem } from '../shared/text'
import { ColorField } from './TextPanel'
import { drawLayout, layoutTemplate, placeholderPhoto, type ThumbLayout } from './thumb'

/** A template the user saved: the whole layout (texts with their content) without the photo, plus a small picture. */
export interface MyTemplate { id: string; name: string; layout: ThumbLayout; theme?: string; preview: string }
export const MAX_MY_TEMPLATES = 30
export function validMyTemplates(value: unknown): value is MyTemplate[] {
  return Array.isArray(value) && value.length <= MAX_MY_TEMPLATES && value.every(item => {
    if (!item || typeof item !== 'object') return false
    const layout = item.layout as Record<string, unknown> | null
    return typeof item.id === 'string' && item.id.length <= 64 && typeof item.name === 'string' && item.name.length <= 40
      && typeof item.preview === 'string' && item.preview.startsWith('data:image/jpeg;base64,') && item.preview.length < 300_000
      && (item.theme === undefined || !!palette(item.theme)) && !!layout && typeof layout === 'object'
      && validBackground(layout.background) && layout.background.photoId === null && (layout.template === undefined || typeof layout.template === 'string')
      && Array.isArray(layout.shapes) && layout.shapes.length <= MAX_SHAPES && layout.shapes.every(validShapeItem)
      && Array.isArray(layout.texts) && layout.texts.length <= MAX_TEXTS && layout.texts.every(validTextItem)
  })
}
export type TemplateFilter = 'all' | 'photo' | 'card' | 'mine'
const FILTERS: [TemplateFilter, string][] = [['all', '전체'], ['photo', '사진형'], ['card', '카드뉴스'], ['mine', '내 템플릿']]
const PREVIEW = 104
let previewIds = 0
const previewId = () => `preview-${++previewIds}`
/** One template drawn small, with the current photo (or a stand-in landscape) and theme. */
function TemplateCard({ template, theme, photo, current, disabled, onApply }: { template: ThumbTemplate; theme?: string; photo: ImageBitmap | null; current: boolean; disabled: boolean; onApply(): void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let alive = true
    const scale = window.devicePixelRatio || 1
    void layoutTemplate(template, theme, { photoId: null, zoom: 100, focusX: 50, focusY: 50 }, [], previewId).then(layout => {
      const node = canvas.current, context = node?.getContext('2d')
      if (!alive || !node || !context) return
      node.width = node.height = Math.round(PREVIEW * scale)
      drawLayout(context, layout, template.kind === 'photo' ? photo ?? placeholderPhoto() : null, node.width)
    }).catch(() => undefined)
    return () => { alive = false }
  }, [template, theme, photo])
  return <button className="template-card" aria-pressed={current} disabled={disabled} aria-label={`템플릿: ${template.name}`} title={template.name} onClick={onApply}>
    <canvas ref={canvas} width={PREVIEW} height={PREVIEW} aria-hidden="true" />
  </button>
}
interface GalleryProps {
  filter: TemplateFilter
  onFilter(filter: TemplateFilter): void
  theme?: string
  current?: string
  photo: ImageBitmap | null
  busy: boolean
  mine: MyTemplate[]
  maxMine: number
  onApply(template: ThumbTemplate): void
  onTheme(id: string | undefined): void
  onSaveMine(): void
  onApplyMine(template: MyTemplate): void
  onDeleteMine(id: string): void
}
export function TemplateGallery({ filter, onFilter, theme, current, photo, busy, mine, maxMine, onApply, onTheme, onSaveMine, onApplyMine, onDeleteMine }: GalleryProps) {
  const shown = THUMB_TEMPLATES.filter(item => filter === 'all' || item.kind === filter)
  return <section className="thumb-panel" aria-label="템플릿">
    <div className="segmented four" role="radiogroup" aria-label="템플릿 종류">
      {FILTERS.map(([value, label]) => <button key={value} role="radio" aria-checked={filter === value} onClick={() => onFilter(value)}>
        {label}{value === 'mine' && mine.length ? ` ${mine.length}` : ''}</button>)}
    </div>
    <div className="theme-row" role="radiogroup" aria-label="색 테마">
      <button role="radio" className="theme-default" aria-checked={!theme} disabled={busy} title="템플릿마다 정해진 색" onClick={() => onTheme(undefined)}>기본</button>
      {PALETTES.map(item => <button key={item.id} role="radio" className="swatch" aria-checked={theme === item.id} disabled={busy} aria-label={`테마: ${item.name}`} title={`${item.name} 테마`}
        style={{ background: `linear-gradient(135deg, ${item.accent} 0 55%, ${item.soft} 55%)` }} onClick={() => onTheme(item.id)} />)}
    </div>
    {filter === 'mine' ? <div className="template-grid" aria-label="내 템플릿 목록">
      <button className="template-card save" disabled={busy || mine.length >= maxMine} aria-label="지금 썸네일을 내 템플릿으로 저장"
        title={mine.length >= maxMine ? `내 템플릿은 ${maxMine}개까지 저장됩니다` : '지금 배치·글자·색을 저장합니다 (사진·스티커 제외)'} onClick={onSaveMine}>＋<span>지금 모양<br />저장</span></button>
      {mine.map(item => <div key={item.id} className="my-template">
        <button className="template-card" disabled={busy} aria-label={`템플릿: ${item.name}`} title={`${item.name} 적용`} onClick={() => onApplyMine(item)}><img src={item.preview} alt="" /></button>
        <button className="remove" disabled={busy} aria-label={`${item.name} 삭제`} title="내 템플릿 삭제" onClick={() => onDeleteMine(item.id)}>×</button>
      </div>)}
    </div> : <div className="template-grid" aria-label="템플릿 목록">
      {shown.map(item => <TemplateCard key={item.id} template={item} theme={theme} photo={photo} current={current === item.id} disabled={busy} onApply={() => onApply(item)} />)}
    </div>}
    <p className="hint">{filter === 'mine' ? '내 템플릿은 글자 내용까지 그대로 불러오고, 지금 넣은 사진은 유지합니다.' : '템플릿을 바꿔도 같은 자리의 글자(제목·머리말·부제…)와 사진은 그대로 옮겨 갑니다.'}</p>
  </section>
}

interface BackgroundProps {
  background: ThumbBackground
  photos: PhotoInfo[]
  busy: boolean
  onChange(patch: Partial<ThumbBackground>, live?: boolean): void
  onCommit(): void
  onOpenPhoto(): void
  /** Takes the photo out of the photo list (the original file stays). */
  onRemovePhoto(id: string): void
}
export function BackgroundPanel({ background, photos, busy, onChange, onCommit, onOpenPhoto, onRemovePhoto }: BackgroundProps) {
  const hasPhoto = !!background.photoId, shown = hasPhoto && !background.hidePhoto
  const slider = (key: 'zoom' | 'focusX' | 'focusY' | 'dim', label: string, min: number, max: number, unit: string) => <label key={key}>{label}
    <input type="range" aria-label={label} min={min} max={max} step="1" disabled={busy || !shown} value={background[key]}
      onChange={e => onChange({ [key]: e.target.valueAsNumber }, true)} onPointerUp={onCommit} onKeyUp={onCommit} onBlur={onCommit}
      onDoubleClick={() => onChange({ [key]: key === 'zoom' ? 100 : key === 'dim' ? background.dim : 50 })} />
    <span className="slider-value" aria-hidden="true">{background[key]}{unit}</span>
  </label>
  return <section className="thumb-panel" aria-label="배경">
    <div className="pane-heading"><h2>사진</h2><button className="link" disabled={busy || !hasPhoto} onClick={() => onChange({ photoId: null })}>사진 빼기</button></div>
    <div className="thumb-photos" role="group" aria-label="배경 사진 고르기">
      <button className="add-photo" disabled={busy} onClick={onOpenPhoto} title="사진 파일을 골라 배경에 넣습니다">＋ 사진 열기</button>
      {photos.map(item => <div key={item.id} className="photo-cell">
        <button className="photo-pick" disabled={busy} aria-pressed={background.photoId === item.id} aria-label={`배경 사진: ${item.name}`} title={`${item.name} · Delete 키로 목록에서 제거`}
          onClick={() => onChange({ photoId: item.id, zoom: 100, focusX: 50, focusY: 50, hidePhoto: undefined })}
          onKeyDown={event => { if ((event.key === 'Delete' || event.key === 'Backspace') && !event.repeat) { event.preventDefault(); event.stopPropagation(); onRemovePhoto(item.id) } }}><img src={item.thumbnail} alt="" /></button>
        <button className="photo-remove" disabled={busy} aria-label={`${item.name} 목록에서 제거`} title="목록에서 제거 (원본 파일은 유지)" onClick={() => onRemovePhoto(item.id)}>×</button>
      </div>)}
    </div>
    {hasPhoto && background.hidePhoto && <label className="check show-photo"><input type="checkbox" checked={false} disabled={busy} onChange={() => onChange({ hidePhoto: undefined })} />사진 보이기 <span className="hint">카드뉴스 템플릿은 사진을 숨깁니다</span></label>}
    <div className="region-fields text-fields" role="group" aria-label="사진 위치">
      {slider('zoom', '확대', 100, 400, '%')}
      {slider('focusX', '좌우 위치', 0, 100, '')}
      {slider('focusY', '위아래 위치', 0, 100, '')}
      {slider('dim', '어둡게', 0, 90, '%')}
      <label>배경색<ColorField label="배경색" value={background.color} disabled={busy} onLive={color => onChange({ color }, true)} onCommit={onCommit} /><span className="hint">사진이 없을 때·사진 아래</span></label>
    </div>
    <p className="hint">{hasPhoto ? '배경은 고른 사진 한 장입니다. 목록의 ×(또는 Delete)는 목록에서 빼고, 사진 빼기는 배경만 비웁니다. 확대한 뒤 좌우·위아래 위치로 보일 부분을 고르세요.' : '사진 편집에서 연 사진을 누르거나 사진 열기로 배경 사진을 넣으세요. 사진을 이 창에 끌어 놓아도 됩니다.'}</p>
  </section>
}

export type ShapePreset = 'rect' | 'round' | 'ellipse' | 'frame' | 'line'
const SHAPE_PRESETS: [ShapePreset, string, ReactNode][] = [
  ['rect', '사각형', <rect key="r" x="2.5" y="4" width="11" height="8" fill="currentColor" />],
  ['round', '둥근 상자', <rect key="r" x="2.5" y="4" width="11" height="8" rx="3" fill="currentColor" />],
  ['ellipse', '원', <circle key="c" cx="8" cy="8" r="5.5" fill="currentColor" />],
  ['frame', '테두리', <rect key="r" x="2.5" y="3.5" width="11" height="9" fill="none" stroke="currentColor" strokeWidth="1.8" />],
  ['line', '선', <rect key="r" x="1.5" y="7" width="13" height="2" fill="currentColor" />]
]
interface ShapeProps {
  shape: ShapeItem | null
  count: number
  busy: boolean
  onAdd(preset: ShapePreset): void
  onStyle(patch: Partial<ShapeStyle>, live?: boolean): void
  onCommit(): void
  children?: ReactNode
}
export function ShapePanel({ shape, count, busy, onAdd, onStyle, onCommit, children }: ShapeProps) {
  const off = busy || !shape
  return <section className="thumb-panel" aria-label="꾸미기">
    <div className="shape-add" role="group" aria-label="도형 넣기">
      {SHAPE_PRESETS.map(([preset, label, icon]) => <button key={preset} disabled={busy || count >= MAX_SHAPES} aria-label={`도형 넣기: ${label}`} title={label} onClick={() => onAdd(preset)}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">{icon}</svg><span>{label}</span></button>)}
    </div>
    <div className="region-fields text-fields" role="group" aria-label="도형 스타일">
      <label title="채우기 불투명도: 0이면 채우지 않음">채우기
        <ColorField label="채우기 색" value={shape?.fill ?? '#ffffff'} disabled={off} onLive={fill => onStyle({ fill }, true)} onCommit={onCommit} />
        <input type="range" aria-label="채우기 불투명도" min="0" max="100" step="1" disabled={off} value={shape?.fillOpacity ?? 100}
          onChange={e => onStyle({ fillOpacity: e.target.valueAsNumber }, true)} onPointerUp={onCommit} onKeyUp={onCommit} onBlur={onCommit} />
        <span className="slider-value" aria-hidden="true">{shape?.fillOpacity ?? ''}</span>
      </label>
      <label title="테두리 두께(px), 0이면 없음">테두리
        <ColorField label="테두리 색" value={shape?.stroke ?? '#000000'} disabled={off} onLive={stroke => onStyle({ stroke }, true)} onCommit={onCommit} />
        <input type="range" aria-label="테두리 두께" min="0" max="60" step="1" disabled={off} value={shape?.strokeWidth ?? 0}
          onChange={e => onStyle({ strokeWidth: e.target.valueAsNumber }, true)} onPointerUp={onCommit} onKeyUp={onCommit} onBlur={onCommit} />
        <span className="slider-value" aria-hidden="true">{shape?.strokeWidth ?? ''}</span>
      </label>
      <label title="모서리 둥글기: 50이면 알약 모양">모서리
        <input type="range" aria-label="모서리 둥글기" min="0" max="50" step="1" disabled={off || shape?.kind === 'ellipse'} value={shape?.radius ?? 0}
          onChange={e => onStyle({ radius: e.target.valueAsNumber }, true)} onPointerUp={onCommit} onKeyUp={onCommit} onBlur={onCommit} />
        <button className="icon bold-toggle" aria-label="도형 그림자" title="그림자" aria-pressed={!!shape?.shadow} disabled={off} onClick={() => onStyle({ shadow: !shape?.shadow })}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="4" width="9" height="9" rx="1.5" fill="currentColor" opacity=".3" /><rect x="2.5" y="2.5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
        </button>
      </label>
    </div>
    <p className="hint">{shape ? '모서리 핸들로 가로·세로 크기를 따로 바꿉니다. 사진 위 도구 막대로 앞뒤 순서를 바꿀 수 있습니다.' : '도형을 넣거나 썸네일의 상자·테두리를 누르면 색과 모양을 바꿀 수 있습니다.'}</p>
    {children}
  </section>
}
