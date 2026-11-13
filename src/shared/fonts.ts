/** Fonts shipped with the app (SIL OFL 1.1, files in src/renderer/public/fonts/<id>/ next to OFL.txt). */
export type FontCategory = 'sans' | 'serif' | 'display' | 'hand'
export interface BundledFont { id: string; name: string; category: FontCategory; files: { 400: string; 700?: string } }
export const BUNDLED_FONTS: readonly BundledFont[] = [
  { id: 'pretendard', name: '프리텐다드', category: 'sans', files: { 400: 'Pretendard-Regular.woff2', 700: 'Pretendard-Bold.woff2' } },
  { id: 'notosans', name: '본고딕 (Noto Sans KR)', category: 'sans', files: { 400: 'NotoSansKR-Regular.woff2', 700: 'NotoSansKR-Bold.woff2' } },
  { id: 'suit', name: '수트 (SUIT)', category: 'sans', files: { 400: 'SUIT-Regular.woff2', 700: 'SUIT-Bold.woff2' } },
  { id: 'nanumgothic', name: '나눔고딕', category: 'sans', files: { 400: 'NanumGothic-Regular.ttf', 700: 'NanumGothic-Bold.ttf' } },
  { id: 'gowundodum', name: '고운돋움', category: 'sans', files: { 400: 'GowunDodum-Regular.woff2' } },
  { id: 'notoserif', name: '본명조 (Noto Serif KR)', category: 'serif', files: { 400: 'NotoSerifKR-Regular.woff2', 700: 'NotoSerifKR-Bold.woff2' } },
  { id: 'nanummyeongjo', name: '나눔명조', category: 'serif', files: { 400: 'NanumMyeongjo-Regular.ttf', 700: 'NanumMyeongjo-Bold.ttf' } },
  { id: 'gowunbatang', name: '고운바탕', category: 'serif', files: { 400: 'GowunBatang-Regular.woff2', 700: 'GowunBatang-Bold.woff2' } },
  { id: 'blackhansans', name: '검은고딕', category: 'display', files: { 400: 'BlackHanSans-Regular.woff2' } },
  { id: 'dohyeon', name: '도현', category: 'display', files: { 400: 'DoHyeon-Regular.woff2' } },
  { id: 'jua', name: '주아', category: 'display', files: { 400: 'Jua-Regular.woff2' } },
  { id: 'dongle', name: '동글', category: 'display', files: { 400: 'Dongle-Regular.woff2', 700: 'Dongle-Bold.woff2' } },
  { id: 'nanumpen', name: '나눔손글씨 펜', category: 'hand', files: { 400: 'NanumPenScript-Regular.ttf' } },
  { id: 'nanumbrush', name: '나눔손글씨 붓', category: 'hand', files: { 400: 'NanumBrushScript-Regular.ttf' } },
  { id: 'gaegu', name: '개구', category: 'hand', files: { 400: 'Gaegu-Regular.woff2', 700: 'Gaegu-Bold.woff2' } }
]
export const CATEGORY_LABELS: Record<FontCategory, string> = { sans: '고딕', serif: '명조', display: '제목·강조', hand: '손글씨' }
export const DEFAULT_FONT = 'pretendard'
/** Fallback for glyphs a font lacks (hanja, rare syllables in 2,350-glyph fonts). */
export const FALLBACK_FONT = 'pretendard'
const SYSTEM_PREFIX = 'system:'
/** Font reference stored on a text item: a bundled id, or `system:<family>` for a font installed on the PC. */
export type FontRef = string
export const systemFont = (family: string): FontRef => SYSTEM_PREFIX + family
export const bundledFont = (ref: FontRef) => BUNDLED_FONTS.find(font => font.id === ref)
export function systemFamily(ref: FontRef): string | null {
  return ref.startsWith(SYSTEM_PREFIX) ? ref.slice(SYSTEM_PREFIX.length) : null
}
/** System family names go inside a quoted CSS font string, so quotes, backslashes and control characters are refused. */
export function validFamilyName(family: unknown): family is string {
  return typeof family === 'string' && family.length >= 1 && family.length <= 120 && !/["\\;{}<>\p{Cc}]/u.test(family) && family.trim() === family
}
export function validFontRef(ref: unknown): ref is FontRef {
  if (typeof ref !== 'string') return false
  const family = systemFamily(ref)
  return family === null ? !!bundledFont(ref) : validFamilyName(family)
}
/** CSS family name under which a bundled font is registered (never collides with an installed font). */
export const bundledFamily = (id: string) => `PK ${id}`
/** CSS font-family list for a reference, with the bundled fallback and the generic family last. */
export function fontFamilyList(ref: FontRef): string {
  const family = systemFamily(ref)
  const primary = family === null ? bundledFamily(bundledFont(ref)?.id ?? DEFAULT_FONT) : family
  return `"${primary}", "${bundledFamily(FALLBACK_FONT)}", sans-serif`
}
export function fontLabel(ref: FontRef): string {
  return systemFamily(ref) ?? bundledFont(ref)?.name ?? ref
}
