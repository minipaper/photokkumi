import { validOutput } from '../shared/output'
import type { SaveRequest } from '../shared/model'
export function trustedSender(senderId: number, expectedId: number, isMainFrame: boolean, url: string, allowedUrl: string) {
  return senderId === expectedId && isMainFrame && url === allowedUrl
}
export function validSaveRequest(value: unknown): value is SaveRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Record<string, unknown>
  return Object.keys(request).length === 3 && typeof request.photoId === 'string'
    && request.photoId.length === 36 && request.png instanceof Uint8Array && validOutput(request.output)
}
