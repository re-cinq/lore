// Pure logic for the agent-watcher (ADR-031): the genuinely new decisions made when
// re-targeting loretask-watcher onto `Agent` CRs — `Agent.status` carries no
// `changedFiles`/`reviewResult`/`taskType`, and the deterministic gate is now the
// repo's GitHub Actions conclusion (D3). The orchestration shell (agent-watcher.ts)
// is IO-bound and untested, as loretask-watcher is; this is the testable core.

import type { Agent as AgentCr } from "@re-cinq/agent-contracts";
import { parseReviewVerdict } from "@re-cinq/lore-assembly-lines";
import { isFeatureLifecycleType } from "../task/worker.js";

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

/**
 * Parse the `REVIEW_RESULT:` marker a review Agent prints to status.output, in the
 * watcher's own vocabulary.
 *
 * The MARKER is the station contract's, so `parseReviewVerdict` owns reading it and
 * this only renames the answer. A second regex pair here drifted from the contract's:
 * it tested APPROVED first, so an output naming both markers — an agent echoing its
 * instruction line before the real verdict — was an approval on this path and a
 * rejection on every assembly-line review node.
 */
export function parseReviewResult(
  output: string | undefined,
): ReviewResult | undefined {
  const verdict = parseReviewVerdict(output);

  if (verdict === "changes_requested") {
    return "changes_requested";
  }

  return verdict === "success" ? "approved" : undefined;
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
 *  it at line completion, so skip when the task type ROUTES to a builtin assembly line —
 *  else the token would be deleted mid-line. (Row existence stopped being the tell once
 *  single-CR tasks got run rows too.) Task-less lines never reach here (no backing task). */
export function decideTokenReclaim(input: {
  phase: string | undefined;
  isAssemblyLineTask: boolean;
}): boolean {
  const terminal = input.phase === "Succeeded" || input.phase === "Failed";

  return terminal && !input.isAssemblyLineTask;
}

/** Map a task's post-handler status onto the run row's outcome vocabulary. */
export function runOutcomeFromTaskStatus(
  status: string,
  phase?: string,
): string {
  if (status === "pr-created" || status === "review") {
    return "pr_created";
  }

  if (status === "failed" || status === "needs-human-help") {
    return "failed";
  }

  if (status === "completed") {
    return "completed";
  }

  // Un-advanced task (still running/queued): no post-handler set a terminal
  // status, so the CR phase decides — a Failed CR (e.g. crash, or Failed with no
  // failureReason so handleFailure never ran) must not close its row as completed.
  return phase === "Failed" ? "failed" : "completed";
}

/** The feature a completed run's PR belongs to, or null when it belongs to none.
 *
 *  Keyed on the task carrying a feature — NOT on the task type being
 *  `feature-finalize`. The merged line runs a feature's whole life under one
 *  `feature-planning` task (FR6.26), so the old check silently stopped linking: push
 *  opened the spec PR, nothing flipped the feature to `pr-open`, and the wizard sat on
 *  "Creating the spec PR…" forever while the work had in fact completed. A planning
 *  ROUND never reaches here — only a run that produced a PR does. */
export function decideFeatureLink(
  taskType: string,
  contextBundle: { feature_id?: string; slug?: string } | undefined,
): { featureId: string; slug: string | undefined } | null {
  if (!isFeatureLifecycleType(taskType) || !contextBundle?.feature_id) {
    return null;
  }

  return { featureId: contextBundle.feature_id, slug: contextBundle.slug };
}

/** The web-ui task page — the canonical log surface (#1294). Undefined when no
 *  UI base URL is configured: callers drop the link rather than fabricate one. */
export function taskPageUrl(
  taskId: string,
  uiUrl: string | undefined,
): string | undefined {
  if (!uiUrl) {
    return undefined;
  }

  return `${uiUrl.replace(/\/+$/, "")}/tasks/${taskId}`;
}

/** The slice of AssemblyRunsPort the PR stamp needs — kept narrow for tests. */
export interface PrStampRuns {
  listForTask(taskId: string): Promise<Array<{ id: string; status: string }>>;
  mergeArgs(id: string, patch: Record<string, unknown>): Promise<void>;
}

/**
 * Persist `{ pr_url, pr_number }` onto the task's open assembly runs at
 * PR-open (specs/implementation-loop FR3/FR4). The await-pr human station's
 * `route: "{args.pr_url}"` resolves at read time from these args, so they must
 * be on the row before the run parks. mergeArgs merges in SQL, so concurrent
 * node artifacts are not clobbered. Resolution goes through the task — the
 * PR-keyed lookup (findOpenByPr) matches on args.pr_number, which does not
 * exist until this very stamp.
 */
export async function stampPrOnOpenRuns(
  runs: PrStampRuns,
  taskId: string,
  pr: { url: string; number: number },
): Promise<void> {
  const open = (await runs.listForTask(taskId)).filter((row) =>
    ["queued", "running"].includes(row.status),
  );

  await Promise.all(
    open.map((row) =>
      runs.mergeArgs(row.id, { pr_url: pr.url, pr_number: pr.number }),
    ),
  );
}

/**
 * One terminal Agent CR, as the event reported it.
 *
 * The whole CR used to be re-read from the cluster before it was processed,
 * which quietly meant "the cluster the Floor can reach" — so a run executed
 * anywhere else answered `found:false` and settled nothing. Everything the
 * handlers actually read is already in the event (`mapAgentToEvent` puts the
 * full status there for exactly this reason), so the report IS the input.
 */
export interface AgentTerminalReport {
  taskId: string;
  agentName: string | null;
  phase: "Succeeded" | "Failed";
  output: string | undefined;
  failureReason: string | undefined;
}

/** Read a `kubernetes.agent.*` event's params, or null when they do not describe
 *  a terminal run this Floor should settle. */
export function agentTerminalReport(
  params: Record<string, unknown>,
): AgentTerminalReport | null {
  const taskId = params.taskId;
  const phase = params.phase;

  if (typeof taskId !== "string" || taskId === "") {
    return null;
  }

  if (phase !== "Succeeded" && phase !== "Failed") {
    return null;
  }
  const status = (params.status ?? {}) as {
    output?: unknown;
    failureReason?: unknown;
  };
  const agentName = params.agentName;

  return {
    taskId,
    agentName: typeof agentName === "string" ? agentName : null,
    phase,
    output: typeof status.output === "string" ? status.output : undefined,
    failureReason:
      typeof status.failureReason === "string"
        ? status.failureReason
        : undefined,
  };
}

/**
 * A single CR's one visit, in the STATION vocabulary.
 *
 * Station rows carry a `StageOutcome` (`success` / `failed` / …), runs carry a
 * run outcome (`pr_created` / `completed` / `error`). They are different
 * alphabets, and writing one into the other's column invents a value no
 * transition rule can read.
 *
 * Derived FROM the run outcome rather than from the phase, so the row and its
 * visit cannot disagree: both doors that close a single-CR run (the watcher, the
 * reaper's sweep) already compute the run outcome, and each computes it from
 * what it knows — a reported phase, or the backing task's status.
 */
export function stationOutcomeForRunOutcome(
  runOutcome: string,
): "success" | "failed" {
  return runOutcome === "failed" || runOutcome === "error"
    ? "failed"
    : "success";
}

/** What a run was dispatched WITH — the facts the handlers need that the event
 *  does not carry. */
export interface DispatchFacts {
  taskType: string;
  targetRepo: string;
  branch: string;
  description: string;
}

/**
 * Recover a run's dispatch facts from what was written down, in preference
 * order: the run row (which recorded them AT dispatch) then the backing task.
 *
 * These used to be read off `Agent.spec` — the CR's own copy — which is the one
 * source that only exists in the cluster that ran it, and only until the prune.
 */
export function dispatchFacts(
  run: {
    blueprintName: string;
    repo: string;
    branch: string | null;
    args: Record<string, unknown>;
  } | null,
  task: {
    task_type: string;
    target_repo: string;
    target_branch?: string | null;
    description: string;
    context_bundle?: Record<string, unknown> | null;
  } | null,
): DispatchFacts | null {
  if (run) {
    return {
      taskType: run.blueprintName,
      targetRepo: run.repo,
      branch: run.branch ?? "",
      description: String(run.args.description ?? ""),
    };
  }

  if (!task) {
    return null;
  }
  // `context_bundle.branch` first: a revision task is dispatched onto the branch
  // it names, while `target_branch` is only written once a PR exists.
  const bundleBranch = task.context_bundle?.branch;

  return {
    taskType: task.task_type,
    targetRepo: task.target_repo,
    branch:
      typeof bundleBranch === "string"
        ? bundleBranch
        : (task.target_branch ?? ""),
    description: task.description,
  };
}
