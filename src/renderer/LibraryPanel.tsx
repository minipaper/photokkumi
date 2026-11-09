import { useState } from 'react'
import type { LibrarySticker, StickerMetadata } from '../shared/library'
interface Props {
  mode: 'pick' | 'manage'; items: LibrarySticker[]; disabled: boolean; canUse: boolean; activeIds: string[]
  onUse(id: string): void
  onImport(): void
  onBackup(): void
  onRestore(): void
  onUpdate(id: string, metadata: StickerMetadata): Promise<boolean>
  onDelete(id: string): Promise<boolean>
  onManage?(): void
}
export function LibraryPanel(props: Props) {
  const [category, setCategory] = useState('')
  const [favorites, setFavorites] = useState(false)
  const [editing, setEditing] = useState<LibrarySticker | null>(null)
  const [deleting, setDeleting] = useState<LibrarySticker | null>(null)
  const selectedCategory = props.items.some(item => item.category === category) ? category : ''
  const filtered = props.items.filter(item => (!selectedCategory || item.category === selectedCategory) && (!favorites || item.favorite))
  return <section className="library" aria-label={props.mode === 'manage' ? '스티커 관리 목록' : '스티커 라이브러리'}>
    <div className="pane-heading">
      <h2>{props.mode === 'manage' ? '스티커 관리' : '스티커 라이브러리'} <small>{props.items.length}/100</small></h2>
      {props.onManage && <button disabled={props.disabled} onClick={props.onManage}>스티커 관리</button>}
    </div>
    {props.mode === 'manage' && <div className="library-tools">
      <button disabled={props.disabled} onClick={props.onImport}>PNG 등록</button>
      <button disabled={props.disabled || !props.items.length} onClick={props.onBackup}>백업</button>
      <button disabled={props.disabled} onClick={props.onRestore}>복원</button>
    </div>}
    {(props.mode === 'manage' || !!props.items.length) && <div className="library-filter">
    <label>분류<select aria-label="분류 필터" value={selectedCategory} onChange={event => setCategory(event.target.value)}>
      <option value="">전체</option>
      {[...new Set(props.items.map(item => item.category).filter(Boolean))].sort().map(name => <option key={name}>{name}</option>)}
    </select></label>
    <label className="checkbox"><input type="checkbox" checked={favorites} onChange={event => setFavorites(event.target.checked)} />즐겨찾기만</label>
    </div>}
    {!props.items.length && (props.mode === 'pick' ? <div className="library-empty">
      <p>자주 쓰는 PNG 스티커를 등록해 두면 클릭 한 번으로 사진에 올릴 수 있습니다. 등록한 스티커는 다음 실행에도 남아 있습니다.</p>
      <button className="primary" disabled={props.disabled} onClick={props.onImport}>스티커 PNG 추가</button>
      <p className="hint">PNG 파일을 이 목록으로 끌어 놓아도 등록됩니다.</p>
    </div> : <p>PNG 등록을 눌러 스티커를 추가하세요. 등록한 스티커는 다음 실행에도 유지됩니다.</p>)}
    {!!props.items.length && !filtered.length && <p>조건에 맞는 스티커가 없습니다.</p>}
    <div className="sticker-grid">
      {filtered.map(item => <article key={item.id} aria-label={`스티커 ${item.name}`}>
        {props.mode === 'pick' ? <button className="sticker-use" aria-label={`${item.name} 배치`} disabled={props.disabled || !props.canUse} onClick={() => props.onUse(item.id)}>
          <img loading="lazy" src={`app://bundle/stickers/${item.id}.png`} alt={item.name} width="56" height="56" />
          <span title={item.name}>{item.name}</span>
        </button> : <div className="sticker-use"><img src={`app://bundle/stickers/${item.id}.png`} alt={item.name} width="64" height="64" /><span>{item.name}</span></div>}
        {props.mode === 'manage' && <small>{item.category || '미분류'}</small>}
        {props.mode === 'manage' && <div className="sticker-actions">
          <button aria-label={`${item.name} 즐겨찾기`} aria-pressed={item.favorite} disabled={props.disabled} onClick={() => { void props.onUpdate(item.id, { name: item.name, category: item.category, favorite: !item.favorite }) }}>{item.favorite ? '★' : '☆'}</button>
          <button aria-label={`${item.name} 정보 편집`} disabled={props.disabled} onClick={() => setEditing({ ...item })}>편집</button>
          <button aria-label={`${item.name} 삭제`} disabled={props.disabled || props.activeIds.includes(item.id)} onClick={() => setDeleting(item)}>삭제</button>
        </div>}
      </article>)}
    </div>
    {props.mode === 'manage' && editing && <div className="library-form" role="group" aria-label="스티커 정보 편집">
      <label>이름<input aria-label="스티커 이름" maxLength={80} value={editing.name} disabled={props.disabled} onChange={e => setEditing({ ...editing, name: e.target.value })} /></label>
      <label>분류<input aria-label="스티커 분류" maxLength={40} value={editing.category} disabled={props.disabled} onChange={e => setEditing({ ...editing, category: e.target.value })} /></label>
      <button disabled={props.disabled || !editing.name.trim()} onClick={async () => {
        if (await props.onUpdate(editing.id, { name: editing.name, category: editing.category, favorite: props.items.find(item => item.id === editing.id)?.favorite ?? editing.favorite })) setEditing(null)
      }}>정보 저장</button>
      <button disabled={props.disabled} onClick={() => setEditing(null)}>편집 취소</button>
    </div>}
    {props.mode === 'manage' && deleting && <div className="library-form" role="group" aria-label="스티커 삭제 확인">
      <p>라이브러리에서 {deleting.name} 스티커를 삭제할까요? 원본 PNG는 유지됩니다.</p>
      <button disabled={props.disabled} onClick={async () => { if (await props.onDelete(deleting.id)) setDeleting(null) }}>삭제 확인</button>
      <button disabled={props.disabled} onClick={() => setDeleting(null)}>삭제 취소</button>
    </div>}
    {props.mode === 'manage' && <small>모든 사진의 배치·실행취소 이력·마지막 저장 상태에서 사용 중인 파일은 삭제할 수 없습니다.</small>}
  </section>
}
