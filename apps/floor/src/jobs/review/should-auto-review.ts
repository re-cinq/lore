import { settings } from "../../kernel/queues.js";

/**
 * The per-repo `auto_review` opt-in (reused by the agent-watcher post-PR path and
 * the code-review choreography). Pure predicate over a raw settings value so it is
 * testable without the DB; {@link shouldAutoReview} is the DB-backed wrapper.
 */
export function autoReviewEnabled(rawSettings: unknown): boolean {
  const parsed =
    typeof rawSettings === "string" ? safeParse(rawSettings) : rawSettings;
  return (parsed as { auto_review?: boolean } | null)?.auto_review === true;
}

export async function shouldAutoReview(repo: string): Promise<boolean> {
  return autoReviewEnabled(await settings().rawSettings(repo));
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
