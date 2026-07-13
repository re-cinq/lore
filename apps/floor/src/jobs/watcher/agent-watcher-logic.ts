// Pure logic for the agent-watcher (ADR-031): the genuinely new decisions made when
// re-targeting loretask-watcher onto `Agent` CRs — `Agent.status` carries no
// `changedFiles`/`reviewResult`/`taskType`, and the deterministic gate is now the
// repo's GitHub Actions conclusion (D3). The orchestration shell (agent-watcher.ts)
// is IO-bound and untested, as loretask-watcher is; this is the testable core.

import type { Agent as AgentCr } from "@re-cinq/agent-contracts";

export const TASK_ID_LABEL = "lore.re-cinq.com/task-id";
export const TASK_TYPE_LABEL = "lore.re-cinq.com/task-type";

/** The task id / type from the Agent's labels (set by AgentCrBackend). */
export function taskIdOf(agent: AgentCr): string | undefined {
  return agent.metadata?.labels?.[TASK_ID_LABEL];
}
export function taskTypeOf(agent: AgentCr): string | undefined {
  return agent.metadata?.labels?.[TASK_TYPE_LABEL];
}

export type ReviewResult = "approved" | "changes_requested";

/** Parse the `REVIEW_RESULT:` marker a review Agent prints to status.output. */
export function parseReviewResult(
  output: string | undefined,
): ReviewResult | undefined {
  if (!output) {
    return undefined;
  }

  if (/REVIEW_RESULT:\s*APPROVED/i.test(output)) {
    return "approved";
  }

  if (/REVIEW_RESULT:\s*CHANGES_REQUESTED/i.test(output)) {
    return "changes_requested";
  }

  return undefined;
}

export type CiConclusion = "success" | "failure" | "pending" | "none";

/** The deterministic gate (D3): may a Succeeded run with changes proceed to PR-ready
 *  / auto-merge? A red or still-running CI defers; `none` (no CI configured) proceeds
 *  (onboarding scaffolds lore-tests.yml so repos have a gate). */
export function decideCiGate(conclusion: CiConclusion): "proceed" | "defer" {
  return conclusion === "failure" || conclusion === "pending"
    ? "defer"
    : "proceed";
}

/** Reclaim a single-agent task's per-task token when its CR goes terminal (#784). A
 *  multi-node station line shares one `pt-<id>` token across its node CRs and reclaims
 *  it at line completion, so skip when the task has an assembly-line row — else the token
 *  would be deleted mid-line. Task-less lines never reach here (no backing task). */
export function decideTokenReclaim(input: {
  phase: string | undefined;
  hasAssemblyLine: boolean;
}): boolean {
  const terminal = input.phase === "Succeeded" || input.phase === "Failed";

  return terminal && !input.hasAssemblyLine;
}
