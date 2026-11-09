import { validVersion, type UpdateState } from '../shared/update'

/** The parts of electron-updater's autoUpdater this app uses (a fake in unit tests). */
export interface UpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
  on(event: string, listener: (...args: unknown[]) => void): unknown
}

/**
 * Checks GitHub releases quietly, downloads only when the user asks, and installs only after the
 * window has gone through the normal close flow (save / discard / cancel of unsaved edits).
 * Check failures (offline, rate limit) stay silent; download failures are reported.
 */
export class UpdateController {
  private state: UpdateState
  constructor(private updater: UpdaterLike | null, current: string, private notify: (state: UpdateState) => void) {
    this.state = { status: updater ? 'idle' : 'unsupported', current }
    if (!updater) return
    updater.autoDownload = false
    // A downloaded update also installs when the app quits normally (after the close flow).
    updater.autoInstallOnAppQuit = true
    updater.on('update-available', ((info: { version?: unknown }) => {
      if (validVersion(info?.version) && this.state.status !== 'downloading' && this.state.status !== 'ready') this.set({ status: 'available', current, version: info.version })
    }) as never)
    updater.on('update-not-available', (() => { if (this.state.status === 'available' || this.state.status === 'idle') this.set({ status: 'idle', current }) }) as never)
    updater.on('download-progress', ((progress: { percent?: unknown }) => {
      const percent = typeof progress?.percent === 'number' && Number.isFinite(progress.percent) ? Math.max(0, Math.min(100, Math.round(progress.percent))) : 0
      if (this.state.status === 'downloading') this.set({ ...this.state, percent })
    }) as never)
    updater.on('update-downloaded', ((info: { version?: unknown }) => {
      this.set({ status: 'ready', current, version: validVersion(info?.version) ? info.version : this.state.version })
    }) as never)
    updater.on('error', (() => {
      if (this.state.status === 'downloading') this.set({ status: 'error', current, version: this.state.version, message: '업데이트를 내려받지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도하세요.' })
    }) as never)
  }
  get(): UpdateState { return this.state }
  /** Returns the state after the check; network errors leave it unchanged. */
  async check(): Promise<UpdateState> {
    if (!this.updater || this.state.status === 'downloading' || this.state.status === 'ready') return this.state
    try { await this.updater.checkForUpdates() } catch { /* offline or GitHub unavailable: try again later */ }
    return this.state
  }
  async download(): Promise<UpdateState> {
    if (!this.updater || (this.state.status !== 'available' && this.state.status !== 'error') || !this.state.version) throw new Error('내려받을 업데이트가 없습니다.')
    this.set({ status: 'downloading', current: this.state.current, version: this.state.version, percent: 0 })
    // Progress, completion and failure arrive as events; the promise is only awaited to surface rejections.
    void this.updater.downloadUpdate().catch(() => {
      if (this.state.status === 'downloading') this.set({ status: 'error', current: this.state.current, version: this.state.version, message: '업데이트를 내려받지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도하세요.' })
    })
    return this.state
  }
  get ready() { return this.state.status === 'ready' }
  /** Called once the window is closed: runs the installer silently and restarts the app. */
  install() { if (this.updater && this.ready) this.updater.quitAndInstall(true, true) }
  private set(next: UpdateState) { this.state = next; this.notify(next) }
}
