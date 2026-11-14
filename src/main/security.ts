import { validOutput } from '../shared/output'
import type { SaveRequest } from '../shared/model'
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
/** MIME type for a file served from the renderer bundle; fonts only from /fonts/. null = refuse. */
export function bundleFileType(pathname: string, extension: string): string | null {
  return BUNDLE_TYPES[extension] ?? (pathname.startsWith('/fonts/') ? FONT_TYPES[extension] ?? null : null)
}
export function validSaveRequest(value: unknown): value is SaveRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Record<string, unknown>
  const keys = Object.keys(request)
  // crop is checked against the photo's size in the save handler; here only its shape.
  return (keys.length === 3 || (keys.length === 4 && 'crop' in request && validCropShape(request.crop))) && typeof request.photoId === 'string'
    && request.photoId.length === 36 && request.png instanceof Uint8Array && validOutput(request.output)
}
