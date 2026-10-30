import type { LoopKey } from "./loop-kinds.js";

const LOOP_BY_LINE: Record<string, LoopKey> = {
  "implementation-loop": "implementation",
  "code-review": "review",
  "code-review-recheck": "review",
  "code-review-reply": "review",
  "auto-merge": "merge",
  "issue-triage": "triage",
  "spec-upkeep": "upkeep",
  "daily-digest": "digest",
  "spec-tickets": "tickets",
};

/** Floor lines no loop switch owns, so nothing can pause them. */
export const NOT_A_LOOP: readonly string[] = [
  "onboard",
  "feature-planning",
  "lore-run-settled",
  "merge",
  "weekly-changelog",
];

/** The loop a floor line's runs belong to, or null for a line no loop switch owns. */
export function loopOfLine(lineId: string): LoopKey | null {
  return LOOP_BY_LINE[lineId] ?? null;
}
