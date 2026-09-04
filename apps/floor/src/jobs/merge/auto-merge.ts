import { trace } from "@opentelemetry/api";
import { allPathsMatch, matchingPatterns } from "@re-cinq/lore-shared";
import { withBackoff } from "@re-cinq/lore-shared/lib/backoff.js";
import { writeAuditLog } from "../lib/audit.js";
import { projectFor } from "../../composition/project-boot.js";

const tracer = trace.getTracer("lore.auto_merge");

export type AutoMergeOutcome =
  | "merged"
  | "deferred:human_review"
  | "deferred:ci_failed"
  | "deferred:bot_changes_requested"
  | "deferred:path_outside_allowlist"
  | "deferred:trust_too_low"
  | "deferred:dark_mode_off"
  | "deferred:no_changes"
  | "deferred:review_in_flight"
  | "deferred:api_failure";

export interface DarkFactoryAutoMerge {
  paths: string[];
  min_trust: "docs" | "tests" | "implementation" | "full";
  require_green_ci: boolean;
  require_bot_approval: boolean;
}

export interface AutoMergePolicyInputs {
  darkFactoryEnabled: boolean;
  autoMerge: DarkFactoryAutoMerge;
  trustLevel: "docs" | "tests" | "implementation" | "full" | undefined;
  changedPaths: string[];
  ciSucceeded: boolean;
  botApproved: boolean;
  humanChangesRequested: boolean;
  /** An open code-review line for this PR — defer until the review completes. */
  reviewInFlight: boolean;
}

export interface AutoMergeDecision {
  outcome: AutoMergeOutcome;
  rule: {
    path_match_count: number;
    trust_level: string | null;
    ci_status: "success" | "failed" | "pending";
    bot_review_state: "APPROVED" | "CHANGES_REQUESTED" | "PENDING";
    human_changes_requested: boolean;
  };
}

const TRUST_ORDER: Record<string, number> = {
  docs: 1,
  tests: 2,
  implementation: 3,
  full: 4,
};

function buildBaseRule(
  inputs: AutoMergePolicyInputs,
): AutoMergeDecision["rule"] {
  return {
    path_match_count: inputs.changedPaths.filter(
      (p) => matchingPatterns(p, inputs.autoMerge.paths).length > 0,
    ).length,
    trust_level: inputs.trustLevel ?? null,
    ci_status: inputs.ciSucceeded ? "success" : "failed",
    bot_review_state: inputs.botApproved ? "APPROVED" : "CHANGES_REQUESTED",
    human_changes_requested: inputs.humanChangesRequested,
  };
}

interface AutoMergeGuard {
  failed: boolean;
  outcome: AutoMergeOutcome;
}

/** Deferral guards in priority order — the first one that fails wins, exactly like the original if-chain. */
function autoMergeGuards(inputs: AutoMergePolicyInputs): AutoMergeGuard[] {
  const minTrust = TRUST_ORDER[inputs.autoMerge.min_trust] ?? 1;
  const actualTrust = inputs.trustLevel
    ? (TRUST_ORDER[inputs.trustLevel] ?? 0)
    : 0;

  return [
    { failed: !inputs.darkFactoryEnabled, outcome: "deferred:dark_mode_off" },
    // A zero-file PR would technically pass the path-allowlist check (vacuous truth) but GitHub's merge call would then 422 on an empty diff — surface the real reason in the audit log instead.
    {
      failed: inputs.changedPaths.length === 0,
      outcome: "deferred:no_changes",
    },
    { failed: inputs.reviewInFlight, outcome: "deferred:review_in_flight" },
    {
      failed: inputs.humanChangesRequested,
      outcome: "deferred:human_review",
    },
    {
      failed: inputs.autoMerge.require_green_ci && !inputs.ciSucceeded,
      outcome: "deferred:ci_failed",
    },
    {
      failed: inputs.autoMerge.require_bot_approval && !inputs.botApproved,
      outcome: "deferred:bot_changes_requested",
    },
    {
      failed: !allPathsMatch(inputs.changedPaths, inputs.autoMerge.paths),
      outcome: "deferred:path_outside_allowlist",
    },
    { failed: actualTrust < minTrust, outcome: "deferred:trust_too_low" },
  ];
}

// Pure decision function: given a fully resolved policy and the PR's observable state, returns the outcome and rule trace, separated so the engine's network calls stay unit-testable apart from the policy logic.
export function evaluateAutoMerge(
  inputs: AutoMergePolicyInputs,
): AutoMergeDecision {
  const rule = buildBaseRule(inputs);
  const failedGuard = autoMergeGuards(inputs).find((guard) => guard.failed);

  if (failedGuard) {
    return { outcome: failedGuard.outcome, rule };
  }

  return { outcome: "merged", rule };
}

export interface AutoMergeJobInputs {
  taskId: string;
  repo: string; // "owner/repo"
  prNumber: number;
  policy: AutoMergePolicyInputs;
}

// End-to-end auto-merge job: evaluates the policy, writes an `auto_merge_decision` audit entry, and merges when the outcome is `merged`; a GitHub API failure during merge degrades to `deferred:api_failure` (R3) — the audit still writes, the PR stays open for a human.
export async function evaluateAndMerge(
  inputs: AutoMergeJobInputs,
): Promise<AutoMergeDecision> {
  return await tracer.startActiveSpan(
    "lore.auto_merge.decision",
    async (span) => {
      span.setAttribute("repo", inputs.repo);
      span.setAttribute("pr_number", inputs.prNumber);
      span.setAttribute("task_id", inputs.taskId);

      try {
        let decision = evaluateAutoMerge(inputs.policy);

        if (decision.outcome === "merged") {
          try {
            await mergeWithBackoff({
              repo: inputs.repo,
              prNumber: inputs.prNumber,
            });
          } catch (err) {
            console.warn(
              `[auto-merge] PR ${inputs.repo}#${inputs.prNumber} merge failed:`,
              (err as Error).message,
            );
            decision = {
              outcome: "deferred:api_failure",
              rule: decision.rule,
            };
          }
        }

        span.setAttribute("decision", decision.outcome);
        span.setAttribute("path_match_count", decision.rule.path_match_count);
        span.setAttribute(
          "trust_level",
          decision.rule.trust_level ?? "unknown",
        );
        span.setAttribute("ci_status", decision.rule.ci_status);
        span.setAttribute("bot_review_state", decision.rule.bot_review_state);

        await writeAuditLog({
          event_type: "auto_merge_decision",
          task_id: inputs.taskId,
          repo: inputs.repo,
          payload: {
            pr_number: inputs.prNumber,
            outcome: decision.outcome,
            rule: decision.rule,
            decided_at: new Date().toISOString(),
          },
        });

        return decision;
      } finally {
        span.end();
      }
    },
  );
}

// Try to merge a PR with backoff (R3): 3 attempts, 1s then 4s tail — throws on final failure so the caller records `deferred:api_failure` and the PR sits open for a human merge.
async function mergeWithBackoff(opts: {
  repo: string;
  prNumber: number;
}): Promise<void> {
  await withBackoff(
    async () => {
      const project = await projectFor(opts.repo);

      await project.pulls.merge(opts.prNumber, "squash");
    },
    { delaysMs: [1000, 4000] },
  );
}
