// Encodes a composed image to PNG off the main thread. On the main thread Chromium runs
// canvas PNG encoding in idle time, which stalled saves for seconds when the window was not in front.
const scope = self as unknown as { onmessage: ((event: MessageEvent<{ bitmap: ImageBitmap }>) => void) | null; postMessage(message: unknown, transfer?: Transferable[]): void }
scope.onmessage = async event => {
  const { bitmap } = event.data
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('no context')
    context.drawImage(bitmap, 0, 0)
    bitmap.close()
    const buffer = await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer()
    scope.postMessage({ buffer }, [buffer])
  } catch { scope.postMessage({ error: true }) }
}
