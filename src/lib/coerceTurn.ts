/** Normalise DB / JSON drift (string years, malformed values) — must match resolver + slot rows. */
export function coerceGameTurn(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(1, Math.floor(raw))
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number.parseInt(raw, 10)
    if (!Number.isNaN(n)) return Math.max(1, n)
  }
  return 1
}
