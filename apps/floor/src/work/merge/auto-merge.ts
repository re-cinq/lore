import type { Span } from "@opentelemetry/api";
import { trace } from "@opentelemetry/api";
import {
  AGENT_INSTRUCTION_PATHS,
  allPathsMatch,
  matchingPatterns,
  pathsMatching,
  type ResolvedDarkFactorySettings,
} from "@re-cinq/lore-shared";
import { withBackoff } from "@re-cinq/lore-shared/lib/backoff.js";
import { writeAuditLog } from "../../outbound/audit.js";
import { projectFor } from "../../outbound/project-boot.js";

const tracer = trace.getTracer("lore.auto_merge");

export type AutoMergeOutcome =
  | "merged"
  | "deferred:human_review"
  | "deferred:ci_failed"
  | "deferred:bot_changes_requested"
  | "deferred:path_outside_allowlist"
  | "deferred:sensitive_path"
  | "deferred:trust_too_low"
  | "deferred:auto_merge_off"
  | "deferred:no_changes"
  | "deferred:review_in_flight"
  | "deferred:api_failure";

/** The resolved (defaults-filled) `auto_merge` block — same shape declared once in the dark-factory-settings model. */
export type DarkFactoryAutoMerge = ResolvedDarkFactorySettings["auto_merge"];

export interface AutoMergePolicyInputs {
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
    escalated_paths: string[];
  };
}

const TRUST_ORDER: Record<string, number> = {
  docs: 1,
  tests: 2,
  implementation: 3,
  full: 4,
};

interface AutoMergeGuard {
  failed: boolean;
  outcome: AutoMergeOutcome;
}

// Pure decision function: given a fully resolved policy and the PR's observable state, returns the outcome and rule trace, separated so the engine's network calls stay unit-testable apart from the policy logic.
export function evaluateAutoMerge(
  inputs: AutoMergePolicyInputs,
): AutoMergeDecision {
  const rule = buildBaseRule(inputs);
  const failedGuard = autoMergeGuards(inputs, rule).find(
    (guard) => guard.failed,
  );

  if (failedGuard) {
    return { outcome: failedGuard.outcome, rule };
  }

  return { outcome: "merged", rule };
}

function buildBaseRule(
  inputs: AutoMergePolicyInputs,
): AutoMergeDecision["rule"] {
  const matchedPaths = inputs.changedPaths.filter(
    (p) => matchingPatterns(p, inputs.autoMerge.paths).length > 0,
  );

  return {
    path_match_count: matchedPaths.length,
    trust_level: inputs.trustLevel ?? null,
    ci_status: inputs.ciSucceeded ? "success" : "failed",
    bot_review_state: inputs.botApproved ? "APPROVED" : "CHANGES_REQUESTED",
    human_changes_requested: inputs.humanChangesRequested,
    escalated_paths: escalatedPaths(inputs),
  };
}

/** The repo's own escalate list plus the agent-instruction floor no repo can switch off. */
function escalatedPaths(inputs: AutoMergePolicyInputs): string[] {
  return pathsMatching(inputs.changedPaths, [
    ...AGENT_INSTRUCTION_PATHS,
    ...inputs.autoMerge.escalate_paths,
  ]);
}

/** Deferral guards in priority order — the first one that fails wins. A zero-file PR would pass the path allowlist vacuously and then 422 on GitHub's own merge call, so it is refused where the audit log can say why. A review in flight defers ahead of the escalate check (#1641), and the escalate check runs ahead of CI and the allowlist, so a match always wins over `paths` and a red PR is still routed to a human. */
function autoMergeGuards(
  inputs: AutoMergePolicyInputs,
  rule: AutoMergeDecision["rule"],
): AutoMergeGuard[] {
  return [
    { failed: !inputs.autoMerge.enabled, outcome: "deferred:auto_merge_off" },
    {
      failed: inputs.changedPaths.length === 0,
      outcome: "deferred:no_changes",
    },
    { failed: inputs.reviewInFlight, outcome: "deferred:review_in_flight" },
    {
      failed: rule.escalated_paths.length > 0,
      outcome: "deferred:sensitive_path",
    },
    ...changeGuards(inputs),
    ...reviewGuards(inputs),
  ];
}

/** Guards about the PR's REVIEW verdict: did anyone object. */
function reviewGuards(inputs: AutoMergePolicyInputs): AutoMergeGuard[] {
  return [
    { failed: inputs.humanChangesRequested, outcome: "deferred:human_review" },
    {
      failed: inputs.autoMerge.require_bot_approval && !inputs.botApproved,
      outcome: "deferred:bot_changes_requested",
    },
  ];
}

/** Guards about the CHANGE itself: whether CI passed, what it touches, and whether this repo is trusted that far. */
function changeGuards(inputs: AutoMergePolicyInputs): AutoMergeGuard[] {
  return [
    {
      failed: inputs.autoMerge.require_green_ci && !inputs.ciSucceeded,
      outcome: "deferred:ci_failed",
    },
    {
      failed: !allPathsMatch(inputs.changedPaths, inputs.autoMerge.paths),
      outcome: "deferred:path_outside_allowlist",
    },
    { failed: trustBelowMinimum(inputs), outcome: "deferred:trust_too_low" },
  ];
}

/** An unset trust level scores 0 — below every configured minimum, so an unconfigured repo never auto-merges. */
function trustBelowMinimum(inputs: AutoMergePolicyInputs): boolean {
  const minTrust = TRUST_ORDER[inputs.autoMerge.min_trust] ?? 1;
  const actualTrust = inputs.trustLevel
    ? (TRUST_ORDER[inputs.trustLevel] ?? 0)
    : 0;

  return actualTrust < minTrust;
}

export interface AutoMergeJobInputs {
  taskId: string;
  repo: string; // "owner/repo"
  prNumber: number;
  policy: AutoMergePolicyInputs;
}

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
        const decision = await decideAndMerge(inputs);

        recordDecision(span, decision);
        await auditDecision(inputs, decision);

        return decision;
      } finally {
        span.end();
      }
    },
  );
}

// End-to-end auto-merge job: evaluates the policy, writes an `auto_merge_decision` audit entry, and merges when the outcome is `merged`; a GitHub API failure during merge degrades to `deferred:api_failure` (R3) — the audit still writes, the PR stays open for a human.
/** A merge the rules ALLOWED but the API refused is not an approval that stands — it becomes `deferred:api_failure`, so the audit log records that nothing merged rather than that the gate passed. */
async function decideAndMerge(
  inputs: AutoMergeJobInputs,
): Promise<AutoMergeDecision> {
  const decision = evaluateAutoMerge(inputs.policy);

  await flagIfSensitive(inputs, decision);

  if (decision.outcome !== "merged") {
    return decision;
  }

  try {
    await mergeWithBackoff({ repo: inputs.repo, prNumber: inputs.prNumber });

    return decision;
  } catch (err) {
    console.warn(
      `[auto-merge] PR ${inputs.repo}#${inputs.prNumber} merge failed:`,
      (err as Error).message,
    );

    return { outcome: "deferred:api_failure", rule: decision.rule };
  }
}

const HUMAN_REVIEW_LABEL = "needs-human-review";

async function flagIfSensitive(
  inputs: AutoMergeJobInputs,
  { outcome, rule }: AutoMergeDecision,
): Promise<void> {
  if (outcome === "deferred:sensitive_path") {
    await flagForHumanReview(inputs, rule.escalated_paths);
  }
}

/** Labels the PR and names the escalated paths once. Every check run re-evaluates the PR, so the label is what keeps the comment from repeating. CODEOWNERS routing is GitHub's own, requested when the PR opens. A GitHub failure is logged, not thrown: the PR already cannot merge, and the audit row must still be written. */
async function flagForHumanReview(
  inputs: AutoMergeJobInputs,
  escalated: string[],
): Promise<void> {
  try {
    const { pulls } = await projectFor(inputs.repo);
    const pr = await pulls.get(inputs.prNumber);

    if (pr?.labels.includes(HUMAN_REVIEW_LABEL)) {
      return;
    }
    await pulls.addLabel(inputs.prNumber, HUMAN_REVIEW_LABEL);
    await pulls.comment(inputs.prNumber, humanReviewComment(escalated));
  } catch (err) {
    console.warn(
      `[auto-merge] PR ${inputs.repo}#${inputs.prNumber} escalation label/comment failed:`,
      (err as Error).message,
    );
  }
}

function humanReviewComment(escalated: string[]): string {
  const list = escalated.map((path) => `- \`${path}\``).join("\n");

  return `Auto-merge stopped: this PR touches paths that always need a human review.\n\n${list}`;
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

/** The rule trace on the span. Every input that could have deferred the merge is attached, so a "why did this not merge" question is answerable from the trace alone rather than by re-reading the PR. */
function recordDecision(
  span: Span,
  { outcome, rule }: AutoMergeDecision,
): void {
  span.setAttribute("decision", outcome);
  span.setAttribute("path_match_count", rule.path_match_count);
  span.setAttribute("escalated_path_count", rule.escalated_paths.length);
  span.setAttribute("trust_level", rule.trust_level ?? "unknown");
  span.setAttribute("ci_status", rule.ci_status);
  span.setAttribute("bot_review_state", rule.bot_review_state);
}

/** The durable half of the same record. Traces expire; `pipeline.audit_log` is what the dark-factory rollback runbook queries months later. */
async function auditDecision(
  inputs: AutoMergeJobInputs,
  decision: AutoMergeDecision,
): Promise<void> {
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
}
