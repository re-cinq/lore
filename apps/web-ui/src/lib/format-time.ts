/** Whole seconds as m:ss (e.g. 75 → "1:15"); negatives clamp to "0:00". */
export function formatSeconds(total: number): string {
  const s = Math.max(0, Math.floor(total));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
