import { settings } from "../../kernel/queues.js";

/**
 * The per-repo `implementation_loop.enabled` opt-in (implementation-loop FR7).
 * Deliberately top-level next to `auto_review`, NOT inside `dark_factory`: the
 * loop never merges, so it must not be dragged behind the two-key CODEOWNERS
 * ceremony that guards merge authority. Pure predicate over a raw settings
 * value, defaulting to disabled by omission; {@link shouldRunImplementationLoop}
 * is the DB-backed wrapper.
 */
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
