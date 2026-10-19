/** The per-repo `implementation_loop.enabled` opt-in (FR7); a plain setting, since the loop never merges and needs no two-key CODEOWNERS ceremony. */
export function implementationLoopEnabled(rawSettings: unknown): boolean {
  const parsed =
    typeof rawSettings === "string" ? safeParse(rawSettings) : rawSettings;
  const block = (
    parsed as { implementation_loop?: { enabled?: unknown } } | null
  )?.implementation_loop;

  return block?.enabled === true;
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
