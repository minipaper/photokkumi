import { EventEmitter } from 'node:events'
import { expect, it } from 'vitest'
import { UpdateController, type UpdaterLike } from '../src/main/updater'
import { validUpdateState } from '../src/shared/update'

class FakeUpdater extends EventEmitter implements UpdaterLike {
  autoDownload = true; autoInstallOnAppQuit = false
  checks = 0; downloads = 0; installed: unknown[] | null = null
  failDownload = false
  async checkForUpdates() { this.checks++; return null }
  async downloadUpdate() { this.downloads++; if (this.failDownload) throw new Error('net'); return [] }
  quitAndInstall(...args: unknown[]) { this.installed = args }
}

it('업데이트는 사용자가 누를 때만 내려받고, 받은 뒤에만 조용히 설치·재시작한다', async () => {
  const fake = new FakeUpdater(), seen: string[] = []
  const updates = new UpdateController(fake, '0.1.2', state => seen.push(state.status))
  expect([fake.autoDownload, fake.autoInstallOnAppQuit]).toEqual([false, true])
  expect(updates.get()).toEqual({ status: 'idle', current: '0.1.2' })
  await updates.check(); expect(fake.checks).toBe(1)
  fake.emit('update-available', { version: '0.1.3' })
  expect(updates.get()).toMatchObject({ status: 'available', version: '0.1.3' })
  updates.install(); expect(fake.installed).toBeNull()
  await updates.download()
  expect(updates.get()).toMatchObject({ status: 'downloading', percent: 0 })
  fake.emit('download-progress', { percent: 42.6 })
  expect(updates.get().percent).toBe(43)
  // A check while downloading does nothing.
  await updates.check(); expect(fake.checks).toBe(1)
  fake.emit('update-downloaded', { version: '0.1.3' })
  expect(updates.get()).toMatchObject({ status: 'ready', version: '0.1.3' })
  updates.install(); expect(fake.installed).toEqual([true, true])
  expect(seen).toEqual(['available', 'downloading', 'downloading', 'ready'])
})

it('확인 실패는 조용히 넘기고, 내려받기 실패는 알리고 다시 시도할 수 있다', async () => {
  const fake = new FakeUpdater()
  fake.checkForUpdates = async () => { throw new Error('offline') }
  const updates = new UpdateController(fake, '0.1.2', () => {})
  await expect(updates.check()).resolves.toEqual({ status: 'idle', current: '0.1.2' })
  fake.emit('error', new Error('offline'))
  expect(updates.get().status).toBe('idle')
  await expect(updates.download()).rejects.toThrow()
  fake.emit('update-available', { version: 'not-a-version' })
  expect(updates.get().status).toBe('idle')
  fake.emit('update-available', { version: '0.2.0' })
  fake.failDownload = true
  await updates.download(); await Promise.resolve(); await Promise.resolve()
  expect(updates.get()).toMatchObject({ status: 'error', version: '0.2.0' })
  fake.failDownload = false
  await updates.download()
  expect(updates.get().status).toBe('downloading')
})

it('개발 실행·macOS에서는 업데이트를 지원하지 않고, 경계 검증은 잘못된 상태를 거부한다', async () => {
  const updates = new UpdateController(null, '0.1.2', () => {})
  expect((await updates.check()).status).toBe('unsupported')
  await expect(updates.download()).rejects.toThrow()
  expect(validUpdateState({ status: 'ready', current: '0.1.2', version: '0.1.3' })).toBe(true)
  expect(validUpdateState({ status: 'ready', current: '0.1.2', version: '<script>' })).toBe(false)
  expect(validUpdateState({ status: 'downloading', current: '0.1.2', percent: 101 })).toBe(false)
  expect(validUpdateState({ status: 'hacked', current: '0.1.2' })).toBe(false)
})
