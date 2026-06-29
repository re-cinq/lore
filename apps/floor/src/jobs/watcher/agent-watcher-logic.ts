// Pure logic for the agent-watcher (ADR-031): the genuinely new decisions made when
// re-targeting loretask-watcher onto `Agent` CRs — `Agent.status` carries no
// `changedFiles`/`reviewResult`/`taskType`, and the deterministic gate is now the
// repo's GitHub Actions conclusion (D3). The orchestration shell (agent-watcher.ts)
// is IO-bound and untested, as loretask-watcher is; this is the testable core.

import { isTerminal, type Agent } from "@re-cinq/agent-contracts";

export const TASK_ID_LABEL = "lore.re-cinq.com/task-id";
export const TASK_TYPE_LABEL = "lore.re-cinq.com/task-type";

/** The task id / type from the Agent's labels (set by AgentBackend). */
export function taskIdOf(agent: Agent): string | undefined {
  return agent.metadata?.labels?.[TASK_ID_LABEL];
}
export function taskTypeOf(agent: Agent): string | undefined {
  return agent.metadata?.labels?.[TASK_TYPE_LABEL];
}

export type ReviewResult = "approved" | "changes_requested";

/** Parse the `REVIEW_RESULT:` marker a review Agent prints to status.output. */
export function parseReviewResult(output: string | undefined): ReviewResult | undefined {
  if (!output) return undefined;
  if (/REVIEW_RESULT:\s*APPROVED/i.test(output)) return "approved";
  if (/REVIEW_RESULT:\s*CHANGES_REQUESTED/i.test(output)) return "changes_requested";
  return undefined;
}

export type CiConclusion = "success" | "failure" | "pending" | "none";

/** The deterministic gate (D3): may a Succeeded run with changes proceed to PR-ready
 *  / auto-merge? A red or still-running CI defers; `none` (no CI configured) proceeds
 *  (onboarding scaffolds lore-tests.yml so repos have a gate). */
export function decideCiGate(conclusion: CiConclusion): "proceed" | "defer" {
  return conclusion === "failure" || conclusion === "pending" ? "defer" : "proceed";
}

export type AgentOutcome =
  | { kind: "ignore" }
  | { kind: "failed"; reason: string }
  | { kind: "review-verdict"; result: ReviewResult }
  | { kind: "no-changes" }
  | { kind: "pr" };

/** Map a terminal Agent (+ its already-computed changed-file count) to the watcher's
 *  next action. Mirrors loretask-watcher's phase branches, adapted to Agent CRs. */
export function decideAgentOutcome(args: {
  phase: string | undefined;
  taskType: string | undefined;
  reviewResult: ReviewResult | undefined;
  changedFiles: number;
  failureReason: string | undefined;
  alreadyHandled: boolean;
}): AgentOutcome {
  if (args.alreadyHandled) return { kind: "ignore" };
  if (args.phase === "Failed") {
    return { kind: "failed", reason: args.failureReason ?? "unknown" };
  }
  if (args.phase !== "Succeeded") return { kind: "ignore" };
  if (args.taskType === "review") {
    return args.reviewResult
      ? { kind: "review-verdict", result: args.reviewResult }
      : { kind: "ignore" };
  }
  return args.changedFiles === 0 ? { kind: "no-changes" } : { kind: "pr" };
}

/** True once an Agent reached a terminal phase (re-exported for the shell). */
export function agentIsTerminal(agent: Agent): boolean {
  return isTerminal(agent);
}
