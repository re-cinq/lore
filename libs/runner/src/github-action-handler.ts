// github_action node assembly line handler (ADR-031 D3, #686 Wave 2). Non-AI workflow steps gate
// on the repo's own GitHub Actions rather than an LLM: the node polls the branch's CI
// conclusion to a terminal verdict (success/failure), heartbeating the branch lease while
// it waits, and maps it to a node outcome. ciConclusion / heartbeat / sleep are injected
// ports so the loop + mapping are deterministically testable.

import type { NodeHandler, NodeResult, NodeContext, StageOutcome } from "./assembly-line-executor.js";
import type { WorkflowNode } from "./loader.js";

/** Mirrors @re-cinq/lore-shared's CiConclusion (kept local to avoid a heavy import). */
export type CiConclusion = "success" | "failure" | "pending" | "none";

export interface GithubActionDeps {
  /** Aggregate CI conclusion for the branch's head commit. */
  ciConclusion: (branch: string) => Promise<CiConclusion>;
  /** Refresh the branch lease so waiting on CI doesn't let it lapse. */
  heartbeat: (branchName: string, nodeId: string) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  maxPolls?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 15_000;
const DEFAULT_MAX_POLLS = 240; // ~1h at 15s

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

export function createGithubActionHandler(deps: GithubActionDeps): NodeHandler {
  const intervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxPolls = deps.maxPolls ?? DEFAULT_MAX_POLLS;

  return async (node: WorkflowNode, ctx: NodeContext): Promise<NodeResult> => {
    for (let poll = 0; poll < maxPolls; poll++) {
      await deps.heartbeat(ctx.branchName, node.id);
      const conclusion = await deps.ciConclusion(ctx.branchName);
      const outcome = ciOutcome(conclusion);
      if (outcome) {
        return { outcome, extras: { "Lore-CI-Conclusion": conclusion } };
      }
      await deps.sleep(intervalMs);
    }
    return {
      outcome: "failed",
      extras: { "Lore-CI-Conclusion": "timeout", "Lore-Validation-Status": "ci-timeout" },
    };
  };
}
