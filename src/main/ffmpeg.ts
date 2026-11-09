import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs/promises'
import { basename, extname, isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readBounded } from './library'
import { VIDEO_EXTENSIONS, type ToolStatus, type VideoRef } from '../shared/gif'

/**
 * ffmpeg is NOT bundled. The user installs it; we only find and launch it as a separate process,
 * without a shell and with fixed argument arrays (see docs/gif.md).
 */
export interface RunResult { stdout: Buffer; stderr: string; code: number | null }
export function runTool(path: string, args: string[], options: { timeoutMs: number; maxStdout: number; onStdout?(chunk: Buffer): void; signal?: { child?: ChildProcess } }): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(path, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    if (options.signal) options.signal.child = child
    const chunks: Buffer[] = []; let size = 0, stderr = '', settled = false
    const finish = (error: Error | null, result?: RunResult) => {
      if (settled) return
      settled = true; clearTimeout(timer)
      if (error) { child.kill('SIGKILL'); reject(error) } else resolve(result!)
    }
    const timer = setTimeout(() => finish(new Error('ffmpeg 작업 시간이 너무 오래 걸려 중단했습니다.')), options.timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => {
      options.onStdout?.(chunk)
      size += chunk.length
      if (size > options.maxStdout) finish(new Error('ffmpeg 출력이 너무 큽니다.'))
      else if (!options.onStdout) chunks.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => { if (stderr.length < 65536) stderr += chunk.toString('utf8') })
    child.on('error', error => finish(error))
    child.on('close', (code, signal) => {
      if (signal && !settled) finish(new Error('ffmpeg 작업이 취소되었습니다.'))
      else finish(null, { stdout: Buffer.concat(chunks), stderr, code })
    })
  })
}

export async function verifyFfmpeg(path: string): Promise<string> {
  let result: RunResult
  try { result = await runTool(path, ['-hide_banner', '-version'], { timeoutMs: 8000, maxStdout: 1 << 20 }) }
  catch { throw new Error('선택한 파일은 ffmpeg가 아닙니다.') }
  const first = result.stdout.toString('utf8').split(/\r?\n/)[0] ?? ''
  if (result.code !== 0 || !first.startsWith('ffmpeg version')) throw new Error('선택한 파일은 ffmpeg가 아닙니다.')
  return first.slice(0, 120)
}

/** Well-known install locations. GUI apps often miss shell PATH updates (winget, Homebrew), so check them directly. */
export async function candidatePaths(env: NodeJS.ProcessEnv = process.env, platform = process.platform): Promise<string[]> {
  const list = ['ffmpeg']
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA, programs = [env.ProgramFiles, env['ProgramFiles(x86)']].filter(Boolean) as string[]
    if (local) {
      list.push(join(local, 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'))
      const packages = join(local, 'Microsoft', 'WinGet', 'Packages')
      for (const entry of await fs.readdir(packages).catch(() => [] as string[])) {
        if (!/ffmpeg/i.test(entry)) continue
        for (const inner of await fs.readdir(join(packages, entry)).catch(() => [] as string[])) list.push(join(packages, entry, inner, 'bin', 'ffmpeg.exe'))
      }
    }
    for (const root of programs) list.push(join(root, 'ffmpeg', 'bin', 'ffmpeg.exe'))
    list.push('C:\\ffmpeg\\bin\\ffmpeg.exe')
    if (env.ChocolateyInstall) list.push(join(env.ChocolateyInstall, 'bin', 'ffmpeg.exe'))
    if (env.USERPROFILE) list.push(join(env.USERPROFILE, 'scoop', 'shims', 'ffmpeg.exe'))
  } else list.push('/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg')
  return list
}

export class ToolStore {
  private path: string
  private resolved: { path: string; version: string } | null = null
  constructor(private directory: string, private candidates: () => Promise<string[]> = () => candidatePaths()) { this.path = join(directory, 'tools.json') }
  private async saved(): Promise<string | null> {
    try {
      const value = JSON.parse((await readBounded(this.path, 8192)).toString('utf8')) as Record<string, unknown>
      return value.schemaVersion === 1 && typeof value.ffmpegPath === 'string' && isAbsolute(value.ffmpegPath) ? value.ffmpegPath : null
    } catch { return null }
  }
  private async save(path: string) {
    await fs.mkdir(this.directory, { recursive: true })
    const temporary = join(this.directory, `.tools-${randomUUID()}.tmp`)
    try { await fs.writeFile(temporary, JSON.stringify({ schemaVersion: 1, ffmpegPath: path }), { flag: 'wx', mode: 0o600 }); await fs.rename(temporary, this.path) }
    catch (error) { await fs.unlink(temporary).catch(() => undefined); throw error }
  }
  status(): ToolStatus { return { found: !!this.resolved, path: this.resolved?.path ?? null, version: this.resolved?.version ?? null } }
  /** Uses the saved path first, then well-known locations; caches the first verified one. */
  async locate(): Promise<ToolStatus> {
    this.resolved = null
    const saved = await this.saved()
    for (const path of [...(saved ? [saved] : []), ...await this.candidates()]) {
      try { this.resolved = { path, version: await verifyFfmpeg(path) }; break } catch { /* try next */ }
    }
    return this.status()
  }
  async choose(path: string): Promise<ToolStatus> {
    const real = await fs.realpath(path)
    if (!(await fs.stat(real)).isFile()) throw new Error('ffmpeg 실행 파일을 선택하세요.')
    const version = await verifyFfmpeg(real)
    await this.save(real)
    this.resolved = { path: real, version }
    return this.status()
  }
  require(): string {
    if (!this.resolved) throw new Error('ffmpeg를 찾을 수 없습니다. GIF 만들기 화면의 안내에 따라 설치하거나 위치를 지정하세요.')
    return this.resolved.path
  }
}

export const MAX_VIDEO_BYTES = 4 * 1024 ** 3
export class VideoStore {
  private records = new Map<string, { ref: VideoRef; path: string; width?: number; duration?: number }>()
  /** Registers a user-chosen video; only regular files with a known extension and bounded size. */
  async add(input: string): Promise<VideoRef> {
    if (!isAbsolute(input) || !VIDEO_EXTENSIONS.includes(extname(input).toLowerCase())) throw new Error('MOV·MP4 동영상만 GIF로 만들 수 있습니다.')
    const info = await fs.lstat(input)
    if (!info.isFile()) throw new Error('동영상 파일을 확인할 수 없습니다.')
    if (info.size > MAX_VIDEO_BYTES) throw new Error('동영상은 4GB 이하만 열 수 있습니다.')
    const path = await fs.realpath(input)
    const existing = [...this.records.values()].find(item => item.path === path)
    if (existing) return existing.ref
    if (this.records.size >= 20) this.records.delete(this.records.keys().next().value!)
    const ref = { id: randomUUID(), name: basename(path) }
    this.records.set(ref.id, { ref, path })
    return ref
  }
  get(id: string) {
    const record = this.records.get(id)
    if (!record) throw new Error('허용되지 않은 동영상입니다.')
    return record
  }
  clear() { this.records.clear() }
}
