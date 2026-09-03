import { settings } from "../../kernel/queues.js";

/** The per-repo `implementation_loop.enabled` opt-in (FR7); deliberately top-level, not inside `dark_factory`, since the loop never merges and must not need the two-key CODEOWNERS ceremony. */
export function implementationLoopEnabled(rawSettings: unknown): boolean {
  const parsed =
    typeof rawSettings === "string" ? safeParse(rawSettings) : rawSettings;
  const block = (
    parsed as { implementation_loop?: { enabled?: unknown } } | null
  )?.implementation_loop;

  return block?.enabled === true;
}

export async function shouldRunImplementationLoop(
  repo: string,
): Promise<boolean> {
  return implementationLoopEnabled(await settings().rawSettings(repo));
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
