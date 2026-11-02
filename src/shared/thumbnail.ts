// Transform only already-downsampled thumbnails; full photo decode/export stays unchanged.
export function orientThumbnail(bytes: Uint8Array, width: number, height: number, orientation: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 160 || height > 160
    || bytes.length !== width * height * 4 || !Number.isInteger(orientation) || orientation < 1 || orientation > 8) throw new Error('잘못된 썸네일입니다.')
  const rotated = orientation >= 5
  const outputWidth = rotated ? height : width, outputHeight = rotated ? width : height
  if (orientation === 1) return { bytes, width, height }
  const output = new Uint8Array(bytes.length)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let targetX = x, targetY = y
    switch (orientation) {
      case 2: targetX = width - 1 - x; break
      case 3: targetX = width - 1 - x; targetY = height - 1 - y; break
      case 4: targetY = height - 1 - y; break
      case 5: targetX = y; targetY = x; break
      case 6: targetX = height - 1 - y; targetY = x; break
      case 7: targetX = height - 1 - y; targetY = width - 1 - x; break
      case 8: targetX = y; targetY = width - 1 - x; break
    }
    output.set(bytes.subarray((y * width + x) * 4, (y * width + x) * 4 + 4), (targetY * outputWidth + targetX) * 4)
  }
  return { bytes: output, width: outputWidth, height: outputHeight }
}
