import fs from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readBounded } from './library'
import { DEFAULT_OUTPUT, validOutput, type OutputSettings } from '../shared/output'
export class OutputStore {
  private tail: Promise<unknown> = Promise.resolve()
  private path: string
  constructor(private directory: string) { this.path = join(directory, 'settings.json') }
  private async read(): Promise<OutputSettings> {
    let bytes: Buffer
    try { bytes = await readBounded(this.path, 4096) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...DEFAULT_OUTPUT }; throw error }
    const value = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>
    if (!value || Object.keys(value).length !== 2 || value.schemaVersion !== 1 || !validOutput(value.output)) throw new Error('출력 설정 파일이 손상되었습니다. 기존 파일은 보존합니다.')
    return value.output
  }
  get(): Promise<OutputSettings> { return this.tail.then(() => this.read()) }
  set(output: OutputSettings): Promise<OutputSettings> {
    const work = this.tail.then(async () => {
      if (!validOutput(output)) throw new Error('잘못된 출력 설정입니다.')
      const previous = await this.read() // Never replace a damaged file with defaults.
      if (JSON.stringify(previous) === JSON.stringify(output)) return output
      await fs.mkdir(this.directory, { recursive: true })
      const temporary = join(this.directory, `.settings-${randomUUID()}.tmp`)
      try {
        const handle = await fs.open(temporary, 'wx', 0o600)
        try { await handle.writeFile(JSON.stringify({ schemaVersion: 1, output })); await handle.sync() }
        finally { await handle.close() }
        await fs.rename(temporary, this.path)
      } catch (error) { await fs.unlink(temporary).catch(() => undefined); throw error }
      return output
    })
    this.tail = work.catch(() => undefined)
    return work
  }
}
