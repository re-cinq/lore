import type { ReleaseRecord } from "@re-cinq/lore-shared/project/lib/github-port.js";

export type ReleaseAction =
  | { kind: "create"; body: string }
  | { kind: "keep"; url: string }
  | { kind: "complete"; id: number; body: string };

/** What one release needs to carry the summary exactly once: made when absent, left alone when it already has it, otherwise given the summary ahead of whatever body it holds. */
export function releaseAction(
  existing: ReleaseRecord | null,
  summary: string,
): ReleaseAction {
  if (existing === null) {
    return { kind: "create", body: summary };
  }

  if (existing.body.includes(summary)) {
    return { kind: "keep", url: existing.url };
  }

  return {
    kind: "complete",
    id: existing.id,
    body: existing.body === "" ? summary : `${summary}\n\n${existing.body}`,
  };
}
