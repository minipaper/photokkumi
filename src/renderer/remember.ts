/** Small per-install UI preferences in localStorage (lives under userData, survives restarts and updates). */
export function loadPref<T>(key: string, fallback: T, valid: (value: unknown) => value is T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    const value: unknown = JSON.parse(raw)
    return valid(value) ? value : fallback
  } catch { return fallback }
}
export function savePref(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage unavailable: keep defaults next time */ }
}
