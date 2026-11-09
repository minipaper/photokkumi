import fs from 'node:fs/promises'
import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readBounded } from './library'

/** Main-process preferences kept across restarts (userData/prefs.json). Paths never come from the renderer. */
export interface WindowBounds { x: number; y: number; width: number; height: number; maximized: boolean }
export interface Prefs { outputFolder: string | null; photoFolder: string | null; window: WindowBounds | null }
const EMPTY: Prefs = { outputFolder: null, photoFolder: null, window: null }
const int = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
export function validBounds(value: unknown): value is WindowBounds {
  if (!value || typeof value !== 'object') return false
  const b = value as Record<string, unknown>
  return int(b.x, -100_000, 100_000) && int(b.y, -100_000, 100_000) && int(b.width, 200, 20_000) && int(b.height, 200, 20_000) && typeof b.maximized === 'boolean'
}
const validFolder = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length < 4096 && !value.includes('\0') && isAbsolute(value)

export class PrefsStore {
  private path: string
  private tail: Promise<unknown> = Promise.resolve()
  private cache: Prefs | null = null
  constructor(private directory: string) { this.path = join(directory, 'prefs.json') }
  /** A missing or damaged file just means defaults: these are conveniences, not user data. */
  async get(): Promise<Prefs> {
    if (this.cache) return this.cache
    try {
      const value = JSON.parse((await readBounded(this.path, 8192)).toString('utf8')) as Record<string, unknown>
      this.cache = {
        outputFolder: value?.schemaVersion === 1 && validFolder(value.outputFolder) ? value.outputFolder : null,
        photoFolder: value?.schemaVersion === 1 && validFolder(value.photoFolder) ? value.photoFolder : null,
        window: value?.schemaVersion === 1 && validBounds(value.window) ? value.window : null
      }
    } catch { this.cache = { ...EMPTY } }
    return this.cache
  }
  /**
   * Synchronous write for the window-close path: the app quits right after the last window closes,
   * so an async write could be cut off and leave a stray temp file. Needs get() to have run once.
   */
  updateSync(patch: Partial<Prefs>) {
    if (!this.cache) return
    const next = { ...this.cache, ...patch }
    if (next.window !== null && !validBounds(next.window)) return
    this.cache = next
    const temporary = join(this.directory, `.prefs-${randomUUID()}.tmp`)
    try {
      const handle = openSync(temporary, 'wx', 0o600)
      try { writeSync(handle, JSON.stringify({ schemaVersion: 1, ...next })); fsyncSync(handle) }
      finally { closeSync(handle) }
      renameSync(temporary, this.path)
    } catch { try { unlinkSync(temporary) } catch { /* nothing to clean */ } }
  }
  update(patch: Partial<Prefs>): Promise<void> {
    const work = this.tail.then(async () => {
      const next = { ...(await this.get()), ...patch }
      if (next.outputFolder !== null && !validFolder(next.outputFolder)) next.outputFolder = null
      if (next.photoFolder !== null && !validFolder(next.photoFolder)) next.photoFolder = null
      if (next.window !== null && !validBounds(next.window)) next.window = null
      this.cache = next
      await fs.mkdir(this.directory, { recursive: true })
      const temporary = join(this.directory, `.prefs-${randomUUID()}.tmp`)
      try {
        const handle = await fs.open(temporary, 'wx', 0o600)
        try { await handle.writeFile(JSON.stringify({ schemaVersion: 1, ...next })); await handle.sync() }
        finally { await handle.close() }
        await fs.rename(temporary, this.path)
      } catch (error) { await fs.unlink(temporary).catch(() => undefined); throw error }
    })
    this.tail = work.catch(() => undefined)
    return work
  }
}
