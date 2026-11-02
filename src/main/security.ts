export function trustedSender(senderId: number, expectedId: number, isMainFrame: boolean, url: string, allowedUrl: string) {
  return senderId === expectedId && isMainFrame && url === allowedUrl
}
export function validSaveRequest(value: unknown): value is { photoId: string; png: Uint8Array } {
  if (!value || typeof value !== 'object') return false
  const request = value as Record<string, unknown>
  return Object.keys(request).length === 2 && typeof request.photoId === 'string'
    && request.photoId.length === 36 && request.png instanceof Uint8Array
}
