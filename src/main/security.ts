import { validOutput } from '../shared/output'
import type { SaveRequest } from '../shared/model'
import { validTurn } from '../shared/turn'
const validCropShape = (value: unknown) => !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 4
  && ['x', 'y', 'width', 'height'].every(key => Number.isInteger((value as Record<string, unknown>)[key]))
export function trustedSender(senderId: number, expectedId: number, isMainFrame: boolean, url: string, allowedUrl: string) {
  return senderId === expectedId && isMainFrame && url === allowedUrl
}
/** Only the PC font list (Local Font Access) is granted, and only to the app page itself. */
export function allowedPermission(permission: string, origin: string, allowedUrl: string): boolean {
  if (permission !== 'local-fonts') return false
  // URL.origin is 'null' for custom schemes such as app://, so compare scheme and host explicitly.
  try { const from = new URL(origin), page = new URL(allowedUrl); return from.protocol === page.protocol && from.host === page.host && !!page.host } catch { return false }
}
const BUNDLE_TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }
const FONT_TYPES: Record<string, string> = { '.woff2': 'font/woff2', '.ttf': 'font/ttf' }
/**
 * CSP sent with the bundle's scripts. Workers (PNG encoding, face finding) take their policy from their script's
 * response, not from the page, so they get the same limits: own files only, WebAssembly but no JS eval.
 */
export const SCRIPT_CSP = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'"
/** MIME type for a file served from the renderer bundle; fonts only from /fonts/, the face model only from /models/,
 * WebAssembly only from the build's /assets/. null = refuse. */
export function bundleFileType(pathname: string, extension: string): string | null {
  if (BUNDLE_TYPES[extension]) return BUNDLE_TYPES[extension]
  if (pathname.startsWith('/fonts/')) return FONT_TYPES[extension] ?? null
  if (pathname.startsWith('/models/') && extension === '.onnx') return 'application/octet-stream'
  if (pathname.startsWith('/assets/') && extension === '.wasm') return 'application/wasm'
  return null
}
export function validSaveRequest(value: unknown): value is SaveRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Record<string, unknown>
  const keys = Object.keys(request)
  // crop is checked against the photo's size in the save handler; here only its shape. turn is 1–3 quarter turns when present.
  const optional = keys.filter(key => key !== 'photoId' && key !== 'png' && key !== 'output')
  if (keys.length !== 3 + optional.length || !optional.every(key => key === 'crop' || key === 'turn')) return false
  if ('crop' in request && !validCropShape(request.crop)) return false
  if ('turn' in request && (request.turn === undefined || !validTurn(request.turn))) return false
  return keys.includes('photoId') && keys.includes('png') && keys.includes('output') && typeof request.photoId === 'string'
    && request.photoId.length === 36 && request.png instanceof Uint8Array && validOutput(request.output)
}
