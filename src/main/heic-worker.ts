import { parentPort } from 'node:worker_threads'
import { decodeHeic } from './heic-decode'

// One HEIC per worker: decode, reply (pixels transferred, not copied), then the main process terminates the worker.
parentPort?.once('message', (bytes: Uint8Array) => {
  decodeHeic(bytes).then(
    value => parentPort!.postMessage({ ok: true, value }, [value.pixels.buffer as ArrayBuffer]),
    (error: unknown) => parentPort!.postMessage({ ok: false, error: error instanceof Error ? error.message : 'HEIC 사진을 읽지 못했습니다.' }))
})
