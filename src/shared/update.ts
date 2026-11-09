/** Auto-update state shared by main and renderer. Only published (non-draft) GitHub releases are offered. */
export type UpdateStatus = 'unsupported' | 'idle' | 'available' | 'downloading' | 'ready' | 'error'
export interface UpdateState {
  status: UpdateStatus
  /** Running app version. */
  current: string
  /** Offered version (available / downloading / ready, and error after a failed download). */
  version?: string
  /** Download progress 0–100 while downloading. */
  percent?: number
  message?: string
}
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,6}(?:-[0-9A-Za-z.-]{1,32})?$/
export const validVersion = (value: unknown): value is string => typeof value === 'string' && VERSION.test(value)
/** Runtime check for state objects crossing the preload boundary. */
export function validUpdateState(value: unknown): value is UpdateState {
  if (!value || typeof value !== 'object') return false
  const state = value as Record<string, unknown>
  return ['unsupported', 'idle', 'available', 'downloading', 'ready', 'error'].includes(state.status as string)
    && validVersion(state.current)
    && (state.version === undefined || validVersion(state.version))
    && (state.percent === undefined || (typeof state.percent === 'number' && state.percent >= 0 && state.percent <= 100))
    && (state.message === undefined || (typeof state.message === 'string' && state.message.length <= 300))
}
