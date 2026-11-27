/**
 * Face finding for 얼굴 자동 가리기. The detector is YuNet (OpenCV Zoo, MIT; see THIRD_PARTY_NOTICES.md) run by
 * onnxruntime-web in a renderer worker. This file holds the pure parts: the input size, the decoding of
 * YuNet's 12 outputs into boxes (as in OpenCV's FaceDetectorYN), non-maximum suppression, and turning faces
 * into blur regions in photo pixels.
 */
export interface FaceBox { x: number; y: number; width: number; height: number; score: number }
/** Long side the photo is scaled to before detection: faces of about 10–300px are found at this scale. */
export const DETECT_SIDE = 1600
/** Lower than OpenCV's 0.9 default: a missed face is worse than an extra box the user can delete. */
export const SCORE_THRESHOLD = 0.6
export const NMS_THRESHOLD = 0.3
export const MAX_FACES = 50
export const STRIDES = [8, 16, 32] as const
interface Size { width: number; height: number }

/** Detection input: the photo scaled so its long side is at most DETECT_SIDE, padded to a multiple of 32. */
export function detectionSize(photo: Size) {
  const scale = Math.min(1, DETECT_SIDE / Math.max(photo.width, photo.height))
  const width = Math.max(1, Math.round(photo.width * scale)), height = Math.max(1, Math.round(photo.height * scale))
  return { scale, width, height, padWidth: Math.ceil(width / 32) * 32, padHeight: Math.ceil(height / 32) * 32 }
}

/** YuNet's outputs per stride: cls/obj [n], bbox [n × 4] (dx, dy, log w, log h in stride units). */
export type YunetOutputs = Record<string, Float32Array>
const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
export function decodeYunet(outputs: YunetOutputs, padWidth: number, padHeight: number, threshold = SCORE_THRESHOLD): FaceBox[] {
  const faces: FaceBox[] = []
  for (const stride of STRIDES) {
    const cols = padWidth / stride, rows = padHeight / stride
    const cls = outputs[`cls_${stride}`], obj = outputs[`obj_${stride}`], bbox = outputs[`bbox_${stride}`]
    if (!cls || !obj || !bbox || cls.length !== cols * rows || bbox.length !== cols * rows * 4) throw new Error('얼굴 인식 결과 형식이 올바르지 않습니다.')
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      const score = Math.sqrt(clamp01(cls[i]) * clamp01(obj[i]))
      if (score < threshold) continue
      const cx = (c + bbox[i * 4]) * stride, cy = (r + bbox[i * 4 + 1]) * stride
      const width = Math.exp(bbox[i * 4 + 2]) * stride, height = Math.exp(bbox[i * 4 + 3]) * stride
      if (!Number.isFinite(width) || !Number.isFinite(height)) continue
      faces.push({ x: cx - width / 2, y: cy - height / 2, width, height, score })
    }
  }
  return nms(faces)
}
function overlap(a: FaceBox, b: FaceBox) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x), h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  if (w <= 0 || h <= 0) return 0
  const inter = w * h
  return inter / (a.width * a.height + b.width * b.height - inter)
}
/** Keeps the best box of each overlapping group (IoU above NMS_THRESHOLD), best first, at most MAX_FACES. */
export function nms(faces: FaceBox[], threshold = NMS_THRESHOLD): FaceBox[] {
  const kept: FaceBox[] = []
  for (const face of [...faces].sort((a, b) => b.score - a.score)) {
    if (kept.length >= MAX_FACES) break
    if (kept.every(other => overlap(face, other) <= threshold)) kept.push(face)
  }
  return kept
}

/**
 * A face box (detection pixels) as a blur region in photo pixels: an ellipse a little larger than the box
 * (YuNet's box hugs brow to chin), clipped to the photo. Faces smaller than 4px after scaling are dropped.
 */
export function faceRegion(face: FaceBox, scale: number, photo: Size): { x: number; y: number; width: number; height: number } | null {
  const cx = (face.x + face.width / 2) / scale, cy = (face.y + face.height / 2) / scale
  const width = face.width / scale * 1.3, height = face.height / scale * 1.4
  if (width < 4 || height < 4 || cx < 0 || cy < 0 || cx > photo.width || cy > photo.height) return null
  return { x: Math.round(cx), y: Math.round(cy), width: Math.round(Math.min(width, photo.width * 2)), height: Math.round(Math.min(height, photo.height * 2)) }
}
