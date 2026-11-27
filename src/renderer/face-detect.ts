import { detectionSize, type FaceBox } from '../shared/faces'
/** One face worker for the app; it is closed after a minute without work to give back the runtime's memory. */
let worker: Worker | null = null, idle = 0, nextId = 1
const pending = new Map<number, { resolve(faces: FaceBox[]): void; reject(error: Error): void }>()
function stopWorker() { worker?.terminate(); worker = null; for (const job of pending.values()) job.reject(new Error('얼굴 인식이 중단되었습니다.')); pending.clear() }
function startWorker() {
  const created = new Worker(new URL('./face-worker.ts', import.meta.url), { type: 'module' })
  created.onmessage = (event: MessageEvent<{ id: number; faces?: FaceBox[]; error?: string }>) => {
    const job = pending.get(event.data.id)
    if (!job) return
    pending.delete(event.data.id)
    if (event.data.faces) job.resolve(event.data.faces); else job.reject(new Error(event.data.error || '얼굴을 찾지 못했습니다.'))
  }
  created.onerror = () => stopWorker()
  return created
}
/** Faces in the photo as shown (turned/tilted), in detection pixels; `scale` maps them back to photo pixels. */
export async function detectFaces(photo: ImageBitmap): Promise<{ faces: FaceBox[]; scale: number }> {
  const size = detectionSize(photo)
  const small = await createImageBitmap(photo, { resizeWidth: size.width, resizeHeight: size.height, resizeQuality: 'high' })
  window.clearTimeout(idle)
  worker ??= startWorker()
  const id = nextId++
  try {
    const faces = await new Promise<FaceBox[]>((resolve, reject) => {
      pending.set(id, { resolve, reject })
      worker!.postMessage({ id, bitmap: small, padWidth: size.padWidth, padHeight: size.padHeight }, [small])
    })
    return { faces, scale: size.scale }
  } finally { idle = window.setTimeout(stopWorker, 60_000) }
}
