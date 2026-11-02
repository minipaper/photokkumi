import { describe, it, expect } from 'vitest'
import { DEFAULT_OUTPUT } from '../src/shared/output'
import { trustedSender, validSaveRequest } from '../src/main/security'

describe('IPC 권한 경계', () => {
  it('현재 창의 정확한 main frame URL만 허용한다', () => {
    const url = 'app://bundle/index.html'
    expect(trustedSender(1, 1, true, url, url)).toBe(true)
    expect(trustedSender(2, 1, true, url, url)).toBe(false)
    expect(trustedSender(1, 1, false, url, url)).toBe(false)
    for (const other of ['https://example.com', 'app://bundle/other.html', url + '#x', 'file:///index.html']) {
      expect(trustedSender(1, 1, true, other, url)).toBe(false)
    }
  })
  it('경로·추가 필드·임의 객체·잘못된 타입을 거부한다', () => {
    const good = { photoId: '00000000-0000-0000-0000-000000000000', png: new Uint8Array([1]), output: DEFAULT_OUTPUT }
    expect(validSaveRequest(good)).toBe(true)
    for (const bad of [null, undefined, [], {}, { ...good, path: '/tmp/file' }, { ...good, photoId: '../photo' }, { ...good, png: [1] }, { ...good, png: 'image' }, { ...good, output: { ...DEFAULT_OUTPUT, width: 0 } }, { ...good, output: null }]) {
      expect(validSaveRequest(bad)).toBe(false)
    }
  })
})
