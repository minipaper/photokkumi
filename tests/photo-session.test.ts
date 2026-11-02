import { it, expect } from 'vitest'
import { createPhotoSession, editPhotoSession, savePhotoSession, discardPhotoSession } from '../src/shared/photo-session'
import { addInstance, commitScene } from '../src/shared/scene'
it('사진별 이력과 저장 기준을 분리하고 버리기는 마지막 저장 상태를 복원한다', () => {
  const first = createPhotoSession(), other = createPhotoSession()
  const history = commitScene(first.history, addInstance(first.history.present, { id: 'a', assetId: 's', x: 10, y: 20, width: 40, height: 20, rotation: 0, zOrder: 0 }))
  const edited = editPhotoSession(first, history)
  expect(edited.dirty).toBe(true)
  expect(other.history.present.stickers).toEqual([])
  expect(discardPhotoSession(edited).history.present.stickers).toEqual([])
  const saved = savePhotoSession(edited)
  expect(saved.dirty).toBe(false)
  expect(saved.saved).toBe(true)
  const changed = editPhotoSession(saved, other.history)
  expect(changed.dirty).toBe(true)
  expect(discardPhotoSession(changed).history.present.stickers).toHaveLength(1)
  expect(discardPhotoSession(changed).history.past).toEqual([])
})
