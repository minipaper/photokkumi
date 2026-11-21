import { validFontRef, type FontRef } from './fonts'
import { stickerIcon } from './sticker-icons'

/**
 * 스티커 만들기: blog notice (공정위 표기) stickers, section headings and closing stickers drawn as transparent PNGs.
 * A design is a fixed arrangement; the user only fills its fields (title, body with [강조] marks, caption, icon) and colors.
 */
export type StickerKind = 'notice' | 'heading' | 'end'
export const KIND_LABELS: Record<StickerKind, string> = { notice: '공정위 표기', heading: '소제목', end: '마무리' }
/** Library category for stickers added from each kind. */
export const KIND_CATEGORIES: Record<StickerKind, string> = { notice: '공정위', heading: '소제목', end: '마무리' }
export type StickerField = 'title' | 'body' | 'caption' | 'icon'
export interface StickerDesign { id: string; name: string; kind: StickerKind; fields: readonly StickerField[] }
export const STICKER_DESIGNS: readonly StickerDesign[] = [
  { id: 'n-plain', name: '문장만', kind: 'notice', fields: ['body'] },
  { id: 'n-dots', name: '강조점', kind: 'notice', fields: ['body'] },
  { id: 'n-marker', name: '형광펜', kind: 'notice', fields: ['body'] },
  { id: 'n-pill', name: '둥근 라벨', kind: 'notice', fields: ['title', 'icon', 'body'] },
  { id: 'n-tape', name: '마스킹테이프', kind: 'notice', fields: ['title', 'body'] },
  { id: 'n-icon', name: '아이콘 + 줄 노트', kind: 'notice', fields: ['title', 'icon', 'body'] },
  { id: 'n-box', name: '테두리 상자', kind: 'notice', fields: ['title', 'icon', 'body'] },
  { id: 'n-card', name: '연한 카드', kind: 'notice', fields: ['title', 'icon', 'body'] },
  { id: 'n-side', name: '왼쪽 세로줄', kind: 'notice', fields: ['title', 'icon', 'body'] },
  { id: 'n-badge', name: '작은 배지', kind: 'notice', fields: ['title', 'icon'] },
  { id: 'h-quote', name: '따옴표 제목', kind: 'heading', fields: ['title', 'caption', 'icon'] },
  { id: 'h-icon-top', name: '아이콘 위 + 형광펜', kind: 'heading', fields: ['title', 'caption', 'icon'] },
  { id: 'h-icon-left', name: '아이콘 옆 + 밑줄', kind: 'heading', fields: ['title', 'caption', 'icon'] },
  { id: 'h-line', name: '양쪽 선', kind: 'heading', fields: ['title', 'caption', 'icon'] },
  { id: 'h-bubble', name: '말풍선', kind: 'heading', fields: ['title', 'caption', 'icon'] },
  { id: 'h-tab', name: '색 띠', kind: 'heading', fields: ['title', 'caption', 'icon'] },
  { id: 'e-ribbon', name: '리본', kind: 'end', fields: ['title', 'caption'] },
  { id: 'e-thanks', name: '양쪽 아이콘', kind: 'end', fields: ['title', 'caption', 'icon'] },
  { id: 'e-bookmark', name: '책갈피', kind: 'end', fields: ['title', 'caption', 'icon'] }
]
export const designById = (id: string) => STICKER_DESIGNS.find(design => design.id === id)

export interface StickerContent { title: string; body: string; caption: string; icon: string }
export interface StickerStyle { ink: string; accent: string; font: FontRef; size: number }
export interface StickerSpec { design: string; content: StickerContent; style: StickerStyle }
/** Body text size in output pixels; every other part scales with it. */
export const STICKER_SIZES: readonly { size: number; name: string }[] = [
  { size: 18, name: '작게' }, { size: 24, name: '보통' }, { size: 32, name: '크게' }, { size: 44, name: '아주 크게' }
]
export const MAX_TITLE = 30, MAX_CAPTION = 40, MAX_BODY_LINES = 8, MAX_LINE = 60
export const DEFAULT_STYLE: StickerStyle = { ink: '#3b3f47', accent: '#3fa9f5', font: 'gowundodum', size: 24 }
/** Accent swatches (pastel-friendly; light ones are darkened automatically where they color text). */
export const STICKER_ACCENTS: readonly { color: string; name: string }[] = [
  { color: '#3fa9f5', name: '하늘' }, { color: '#5b7cfa', name: '파랑' }, { color: '#8e6cef', name: '보라' }, { color: '#e468a8', name: '분홍' },
  { color: '#f0616d', name: '빨강' }, { color: '#ff8a3d', name: '주황' }, { color: '#f5c518', name: '노랑' }, { color: '#7cc043', name: '연두' },
  { color: '#1fae74', name: '초록' }, { color: '#3cc8b4', name: '민트' }, { color: '#b5835a', name: '갈색' }, { color: '#6b7280', name: '회색' }
]

export interface Phrase { id: string; kind: StickerKind; title: string; body?: string; caption?: string; icon: string }
/**
 * Common disclosure sentences (economic interest stated plainly: what was received and from whom),
 * section headings and closings. Text in [brackets] is the highlighted part.
 */
export const PHRASES: readonly Phrase[] = [
  { id: 'product', kind: 'notice', title: '제품 제공', icon: 'box', body: '본 포스팅은 업체로부터\n[제품]을 무상으로 제공받아\n솔직하게 작성한 후기입니다' },
  { id: 'fee', kind: 'notice', title: '원고료 지원', icon: 'coin', body: '본 포스팅은 업체로부터\n[원고료]를 지원받아\n솔직하게 작성한 후기입니다' },
  { id: 'product-fee', kind: 'notice', title: '제품·원고료', icon: 'gift', body: '본 포스팅은 업체로부터\n[제품과 원고료]를 지원받아\n솔직하게 작성한 후기입니다' },
  { id: 'sponsor', kind: 'notice', title: '업체 협찬', icon: 'gift', body: '본 포스팅은 업체로부터\n[무상으로 협찬]받았지만\n직접 체험하고 솔직하게 작성했습니다' },
  { id: 'meal', kind: 'notice', title: '식사권 제공', icon: 'meal', body: '업체로부터 [식사권]을 제공받아\n직접 먹어 보고 작성한 후기입니다' },
  { id: 'stay', kind: 'notice', title: '숙박권 제공', icon: 'bed', body: '업체로부터 [숙박권]을 제공받아\n직접 묵어 보고 작성한 후기입니다' },
  { id: 'pass', kind: 'notice', title: '이용권 제공', icon: 'ticket', body: '업체로부터 [이용권]을 제공받아\n직접 이용해 보고 작성한 후기입니다' },
  { id: 'book', kind: 'notice', title: '도서 제공', icon: 'book', body: '출판사로부터 [도서]를 제공받아\n직접 읽고 작성한 후기입니다' },
  { id: 'invite', kind: 'notice', title: '초대권 제공', icon: 'mail', body: '업체로부터 [초대권]을 제공받아\n직접 관람하고 작성한 후기입니다' },
  { id: 'trial', kind: 'notice', title: '체험단', icon: 'flag', body: '[체험단]으로 선정되어 업체로부터\n제품(서비스)을 무상으로 제공받아\n작성한 후기입니다' },
  { id: 'supporters', kind: 'notice', title: '서포터즈', icon: 'heart', body: '[서포터즈] 활동으로 업체로부터\n지원을 받아 작성한 글입니다' },
  { id: 'discount', kind: 'notice', title: '할인 혜택', icon: 'tag', body: '업체로부터 [할인 혜택]을 제공받아\n작성한 후기입니다' },
  { id: 'points', kind: 'notice', title: '적립금 지원', icon: 'coin', body: '업체로부터 [적립금]을 지원받아\n작성한 후기입니다' },
  { id: 'rental', kind: 'notice', title: '제품 대여', icon: 'clock', body: '업체로부터 제품을 [일정 기간 대여]받아\n사용해 보고 작성한 후기입니다' },
  { id: 'paid-ad', kind: 'notice', title: '유료 광고', icon: 'ad', body: '이 글에는 업체로부터 대가를 받은\n[유료 광고]가 포함되어 있습니다' },
  { id: 'partners', kind: 'notice', title: '쿠팡 파트너스', icon: 'cart', body: '이 포스팅은 쿠팡 파트너스 활동의 일환으로,\n이에 따른 [일정액의 수수료]를 제공받습니다' },
  { id: 'shopping-connect', kind: 'notice', title: '쇼핑커넥트', icon: 'bag', body: '네이버 쇼핑커넥트 활동의 일환으로\n[판매 발생 시 수수료]를 받습니다' },
  { id: 'affiliate', kind: 'notice', title: '제휴 링크', icon: 'link', body: '글 속 [제휴 링크]를 통해 구매하면\n일정 수수료를 받을 수 있습니다' },
  { id: 'referral', kind: 'notice', title: '추천인 코드', icon: 'star', body: '[추천인 코드] 입력 시\n소정의 포인트를 받습니다' },
  { id: 'own-money', kind: 'notice', title: '내돈내산', icon: 'wallet', body: '[직접 구매]해서 사용해 보고\n솔직하게 작성한 후기입니다' },
  { id: 'own-visit', kind: 'notice', title: '내돈내산', icon: 'wallet', body: '[직접 비용을 내고] 다녀온\n솔직한 후기입니다' },

  { id: 'h-location', kind: 'heading', title: '[위치] 안내', caption: '찾아가는 길', icon: 'pin' },
  { id: 'h-parking', kind: 'heading', title: '[주차] 정보', caption: '주차 가능 여부', icon: 'car' },
  { id: 'h-hours', kind: 'heading', title: '[영업] 정보', caption: '영업시간·휴무일', icon: 'clock' },
  { id: 'h-menu', kind: 'heading', title: '[메뉴]·가격', caption: '포스팅 작성일 기준', icon: 'menu' },
  { id: 'h-course', kind: 'heading', title: '[추천] 코스', caption: '가 볼 만한 순서', icon: 'route' },
  { id: 'h-booking', kind: 'heading', title: '[예약] 방법', caption: '예약하는 방법', icon: 'calendar' },
  { id: 'h-transit', kind: 'heading', title: '[교통] 정보', caption: '대중교통으로 가는 길', icon: 'bus' },
  { id: 'h-stay', kind: 'heading', title: '[숙소] 정보', caption: '묵었던 곳', icon: 'bed' },
  { id: 'h-food', kind: 'heading', title: '[주변] 맛집', caption: '근처에서 먹은 곳', icon: 'meal' },
  { id: 'h-cafe', kind: 'heading', title: '[카페] 정보', caption: '분위기와 메뉴', icon: 'cafe' },
  { id: 'h-caution', kind: 'heading', title: '[주의] 사항', caption: '꼭 확인하세요', icon: 'warning' },
  { id: 'h-check', kind: 'heading', title: '[확인] 사항', caption: '가기 전에 확인', icon: 'check' },
  { id: 'h-packing', kind: 'heading', title: '[준비물]', caption: '챙겨 가면 좋아요', icon: 'bag' },
  { id: 'h-price', kind: 'heading', title: '[요금] 안내', caption: '이용 요금', icon: 'coin' },
  { id: 'h-video', kind: 'heading', title: '[참고] 영상', caption: '함께 보면 좋아요', icon: 'play' },
  { id: 'h-photo', kind: 'heading', title: '[사진] 모음', caption: '직접 찍은 사진', icon: 'camera' },
  { id: 'h-review', kind: 'heading', title: '[솔직] 후기', caption: '직접 써 본 느낌', icon: 'pencil' },
  { id: 'h-summary', kind: 'heading', title: '[총평]', caption: '한 줄 정리', icon: 'star' },

  { id: 'e-end', kind: 'end', title: 'END', caption: '읽어 주셔서 감사합니다', icon: 'heart' },
  { id: 'e-thanks', kind: 'end', title: '끝까지 읽어 주셔서 감사합니다', caption: '공감과 댓글은 큰 힘이 돼요', icon: 'heart' },
  { id: 'e-thank-you', kind: 'end', title: 'THANK YOU', caption: '다음 글에서 만나요', icon: 'sparkle' },
  { id: 'e-done', kind: 'end', title: '오늘의 기록 끝', caption: '또 만나요', icon: 'smile' }
]
export const phraseContent = (phrase: Phrase): StickerContent => ({ title: phrase.title, body: phrase.body ?? '', caption: phrase.caption ?? '', icon: phrase.icon })
export const DEFAULT_CONTENTS: Record<StickerKind, StickerContent> = {
  notice: phraseContent(PHRASES.find(item => item.id === 'product')!),
  heading: phraseContent(PHRASES.find(item => item.id === 'h-location')!),
  end: phraseContent(PHRASES.find(item => item.id === 'e-end')!)
}

/** One run of text on a line; `mark` = inside [brackets]. */
export interface Segment { text: string; mark: boolean }
/**
 * `[강조]` marks highlighted text. A bracket without its partner is kept as a plain character,
 * so "[참고" or "a]" still shows what was typed.
 */
export function parseMarks(line: string): Segment[] {
  const segments: Segment[] = []
  const push = (text: string, mark: boolean) => {
    if (!text) return
    const last = segments[segments.length - 1]
    if (last && last.mark === mark) last.text += text; else segments.push({ text, mark })
  }
  let rest = line
  while (rest) {
    const open = rest.indexOf('[')
    const close = open < 0 ? -1 : rest.indexOf(']', open + 1)
    if (open < 0 || close < 0) { push(rest, false); break }
    push(rest.slice(0, open), false)
    if (close === open + 1) push('[]', false); else push(rest.slice(open + 1, close), true)
    rest = rest.slice(close + 1)
  }
  return segments
}
export const plainText = (text: string) => parseMarks(text).map(segment => segment.text).join('')
export const bodyLines = (body: string) => body.split('\n').map(line => line.trimEnd()).filter((line, index, lines) => line || (index > 0 && index < lines.length - 1))

/** Name for the saved file / library item: the title, else the first body line, without marks. */
export function stickerName(spec: StickerSpec): string {
  const design = designById(spec.design)
  const title = design?.fields.includes('title') ? plainText(spec.content.title).trim() : ''
  const name = title || plainText(bodyLines(spec.content.body)[0] ?? '').trim() || plainText(spec.content.title).trim() || '스티커'
  return name.replace(/\s+/g, ' ').slice(0, 40)
}

const COLOR = /^#[0-9a-f]{6}$/i
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f]/
const line = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max && !value.includes('\n') && !CONTROL.test(value)
export function validContent(value: unknown): value is StickerContent {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (Object.keys(v).sort().join(',') !== 'body,caption,icon,title') return false
  if (!line(v.title, MAX_TITLE) || !line(v.caption, MAX_CAPTION) || typeof v.icon !== 'string' || (v.icon !== '' && !stickerIcon(v.icon))) return false
  if (typeof v.body !== 'string' || CONTROL.test(v.body)) return false
  const lines = v.body.split('\n')
  return lines.length <= MAX_BODY_LINES && lines.every(item => item.length <= MAX_LINE)
}
export function validStyle(value: unknown): value is StickerStyle {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return Object.keys(v).sort().join(',') === 'accent,font,ink,size' && typeof v.ink === 'string' && COLOR.test(v.ink)
    && typeof v.accent === 'string' && COLOR.test(v.accent) && validFontRef(v.font) && STICKER_SIZES.some(item => item.size === v.size)
}
export function validSpec(value: unknown): value is StickerSpec {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return Object.keys(v).sort().join(',') === 'content,design,style' && typeof v.design === 'string' && !!designById(v.design) && validContent(v.content) && validStyle(v.style)
}
/** What the maker remembers between runs: the design, one content per kind (switching kinds keeps each) and the look. */
export interface MakerState { design: string; contents: Record<StickerKind, StickerContent>; style: StickerStyle }
export const DEFAULT_MAKER: MakerState = { design: 'n-pill', contents: DEFAULT_CONTENTS, style: DEFAULT_STYLE }
export function validMakerState(value: unknown): value is MakerState {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  const contents = v.contents as Record<string, unknown> | undefined
  return Object.keys(v).sort().join(',') === 'contents,design,style' && typeof v.design === 'string' && !!designById(v.design)
    && !!contents && typeof contents === 'object' && Object.keys(contents).sort().join(',') === 'end,heading,notice'
    && validContent(contents.notice) && validContent(contents.heading) && validContent(contents.end) && validStyle(v.style)
}
export interface MySticker extends StickerSpec { id: string }
export const MAX_MY_STICKERS = 30
export function validMyStickers(value: unknown): value is MySticker[] {
  return Array.isArray(value) && value.length <= MAX_MY_STICKERS
    && value.every(item => !!item && typeof item === 'object' && typeof item.id === 'string' && item.id.length <= 64
      && validSpec({ design: item.design, content: item.content, style: item.style }) && Object.keys(item).length === 4)
}

/** PNGs sent to main for saving or adding to the library. */
export interface MakerItem { name: string; png: Uint8Array }
export interface MakerRequest { items: MakerItem[]; category: string }
export const MAX_MAKER_ITEMS = 40
export const MAX_MAKER_PNG_BYTES = 24 * 1024 * 1024
export function validMakerRequest(value: unknown): value is MakerRequest {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return Object.keys(v).sort().join(',') === 'category,items' && line(v.category, 40) && Array.isArray(v.items)
    && v.items.length >= 1 && v.items.length <= MAX_MAKER_ITEMS
    && v.items.every(item => !!item && typeof item === 'object' && Object.keys(item).sort().join(',') === 'name,png'
      && line(item.name, 60) && (item.name as string).trim().length > 0
      && item.png instanceof Uint8Array && item.png.byteLength > 0 && item.png.byteLength <= MAX_MAKER_PNG_BYTES)
}
export interface MakerSaveReceipt { names: string[]; folderLabel: string }
