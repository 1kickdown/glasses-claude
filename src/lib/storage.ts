export const store = {
  get(key: string): string | null {
    try { return globalThis.localStorage?.getItem(key) ?? null } catch { return null }
  },
  set(key: string, value: string): void {
    try { globalThis.localStorage?.setItem(key, value) } catch { /* ignore */ }
  },
}
