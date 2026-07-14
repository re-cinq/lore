// CI-conclusion → node-outcome mapping for github_action nodes (ADR-031 D3).
// The gating itself runs in the def-github-action station pod
// (apps/lore-station/src/stations/github-action.ts), which polls the repo's CI
// and emits LORE_NODE_RESULT; this module is the shared mapping it uses. The
// old Floor-side polling handler retired with the in-process walk (FR6.9).

import type { StageOutcome } from "./node-types.js";

/** Mirrors @re-cinq/lore-shared's CiConclusion (kept local to avoid a heavy import). */
export type CiConclusion = "success" | "failure" | "pending" | "none";

/** CI conclusion → node outcome; null means "not terminal yet, keep polling". `none`
 *  (no CI configured for the repo) passes so the assembly line isn't blocked on a missing gate. */
export function ciOutcome(conclusion: CiConclusion): StageOutcome | null {
  switch (conclusion) {
    case "success":
      return "success";
    case "failure":
      return "failed";
    case "none":
      return "success";
    case "pending":
      return null;
  }
}
