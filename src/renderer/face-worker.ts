// Finds faces with YuNet (onnxruntime-web, WebAssembly, one thread) off the main thread. Everything is local:
// the model and the runtime are bundled files served from app://bundle; nothing leaves the PC.
import * as ort from 'onnxruntime-web/wasm'
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'
import { STRIDES, decodeYunet, type FaceBox } from '../shared/faces'
type Request = { id: number; bitmap: ImageBitmap; padWidth: number; padHeight: number }
const scope = self as unknown as { onmessage: ((event: MessageEvent<Request>) => void) | null; postMessage(message: { id: number; faces?: FaceBox[]; error?: string }): void }
ort.env.wasm.numThreads = 1
ort.env.wasm.wasmPaths = { wasm: new URL(wasmUrl, self.location.href).href }
let session: Promise<ort.InferenceSession> | null = null
async function load() {
  const response = await fetch(new URL('/models/yunet/yunet.onnx', self.location.href))
  if (!response.ok) throw new Error('얼굴 인식 모델을 불러오지 못했습니다.')
  return ort.InferenceSession.create(new Uint8Array(await response.arrayBuffer()), { executionProviders: ['wasm'] })
}
scope.onmessage = async ({ data: { id, bitmap, padWidth, padHeight } }) => {
  try {
    session ??= load().catch(error => { session = null; throw error })
    const model = await session
    // YuNet takes BGR 0–255 in NCHW, padded at the right/bottom to a multiple of 32 (zeros, as in OpenCV).
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('얼굴 인식용 Canvas를 만들 수 없습니다.')
    context.drawImage(bitmap, 0, 0)
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data
    const plane = padWidth * padHeight, input = new Float32Array(3 * plane)
    for (let y = 0; y < bitmap.height; y++) for (let x = 0; x < bitmap.width; x++) {
      const s = (y * bitmap.width + x) * 4, d = y * padWidth + x
      input[d] = pixels[s + 2]; input[plane + d] = pixels[s + 1]; input[2 * plane + d] = pixels[s]
    }
    canvas.width = 0; canvas.height = 0; bitmap.close()
    const result = await model.run({ [model.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, padHeight, padWidth]) })
    const outputs: Record<string, Float32Array> = {}
    for (const stride of STRIDES) for (const name of ['cls', 'obj', 'bbox']) outputs[`${name}_${stride}`] = result[`${name}_${stride}`].data as Float32Array
    for (const tensor of Object.values(result)) tensor.dispose()
    scope.postMessage({ id, faces: decodeYunet(outputs, padWidth, padHeight) })
  } catch (error) {
    bitmap.close()
    scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  }
}
