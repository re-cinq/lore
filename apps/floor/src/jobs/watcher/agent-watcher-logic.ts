// Pure logic for the agent-watcher (ADR-031): the new decisions from retargeting loretask-watcher onto `Agent` CRs — status carries no changedFiles/reviewResult/taskType, so the gate is now the repo's CI conclusion (D3); the IO-bound shell (agent-watcher.ts) stays untested.

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

// Parses the `REVIEW_RESULT:` marker into the watcher's vocabulary via `parseReviewVerdict` (the station contract's own reader) — a second local regex once drifted, testing APPROVED first, so echoing both markers approved here but rejected on every assembly-line review node.
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

// The deterministic gate (D3): may a Succeeded run proceed to PR-ready/auto-merge? Red or still-running CI defers; `none` (no CI configured) proceeds since onboarding scaffolds lore-tests.yml.
export function decideCiGate(conclusion: CiConclusion): "proceed" | "defer" {
  return conclusion === "failure" || conclusion === "pending"
    ? "defer"
    : "proceed";
}

// Reclaim a single-agent task's per-task token when its CR goes terminal (#784); skip when the task type ROUTES to a builtin assembly line, since a multi-node line shares one `pt-<id>` token and reclaims it at line completion — else it'd be deleted mid-line.
export function decideTokenReclaim(input: {
  phase: string | undefined;
  isAssemblyLineTask: boolean;
}): boolean {
  const terminal = input.phase === "Succeeded" || input.phase === "Failed";

  return terminal && !input.isAssemblyLineTask;
}

/** Post-handler statuses that map directly to a run outcome, independent of CR phase. */
const TERMINAL_STATUS_OUTCOME: Record<string, string> = {
  "pr-created": "pr_created",
  review: "pr_created",
  failed: "failed",
  "needs-human-help": "failed",
  completed: "completed",
};

/** Map a task's post-handler status onto the run row's outcome vocabulary. */
export function runOutcomeFromTaskStatus(
  status: string,
  phase?: string,
): string {
  const mapped = TERMINAL_STATUS_OUTCOME[status];

  if (mapped) {
    return mapped;
  }

  // Un-advanced task: no post-handler set a terminal status, so the CR phase decides — a Failed CR must not close its row as completed.
  return phase === "Failed" ? "failed" : "completed";
}

// The feature a completed run's PR belongs to, or null; keyed on the task carrying a feature (not on task type being `feature-finalize`) — the old type-based check silently stopped linking once FR6.26 merged a feature's life under one `feature-planning` task, leaving the wizard stuck on "Creating the spec PR…" forever.
export function decideFeatureLink(
  taskType: string,
  contextBundle: { feature_id?: string; slug?: string } | undefined,
): { featureId: string; slug: string | undefined } | null {
  if (!isFeatureLifecycleType(taskType) || !contextBundle?.feature_id) {
    return null;
  }

  return { featureId: contextBundle.feature_id, slug: contextBundle.slug };
}

// The web-ui task page — the canonical log surface (#1294); undefined when no UI base URL is configured, so callers drop the link rather than fabricate one.
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

// Persist `{ pr_url, pr_number }` onto the task's open assembly runs at PR-open (specs/implementation-loop FR3/FR4) — the await-pr station's `route: "{args.pr_url}"` reads these args, so they must land before the run parks; mergeArgs merges in SQL so concurrent node artifacts aren't clobbered.
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

// One terminal Agent CR as the event reported it — the whole CR used to be re-read from the cluster, which quietly meant "the cluster the Floor can reach", so a run executed elsewhere answered `found:false` and settled nothing; the event now carries everything (mapAgentToEvent), so the report IS the input.
export interface AgentTerminalReport {
  taskId: string;
  agentName: string | null;
  phase: "Succeeded" | "Failed";
  output: string | undefined;
  failureReason: string | undefined;
}

/** The event's taskId + terminal phase, or null when either is missing/non-terminal. */
function parseTerminalPhase(
  params: Record<string, unknown>,
): { taskId: string; phase: "Succeeded" | "Failed" } | null {
  const { taskId, phase } = params;

  if (typeof taskId !== "string" || taskId === "") {
    return null;
  }

  if (phase !== "Succeeded" && phase !== "Failed") {
    return null;
  }

  return { taskId, phase };
}

/** `value` if it is a string, else `fallback`. */
function stringOr<T>(value: unknown, fallback: T): string | T {
  return typeof value === "string" ? value : fallback;
}

// Read a `kubernetes.agent.*` event's params, or null when they do not describe a terminal run this Floor should settle.
export function agentTerminalReport(
  params: Record<string, unknown>,
): AgentTerminalReport | null {
  const parsed = parseTerminalPhase(params);

  if (!parsed) {
    return null;
  }
  const status = (params.status ?? {}) as {
    output?: unknown;
    failureReason?: unknown;
  };

  return {
    taskId: parsed.taskId,
    agentName: stringOr(params.agentName, null),
    phase: parsed.phase,
    output: stringOr(status.output, undefined),
    failureReason: stringOr(status.failureReason, undefined),
  };
}

// A single CR's one visit, in the STATION vocabulary — station rows carry StageOutcome, runs carry a run outcome (pr_created/completed/error); different alphabets, so this derives FROM the run outcome (not the phase) so the row and its visit can't disagree.
export function stationOutcomeForRunOutcome(
  runOutcome: string,
): "success" | "failed" {
  return runOutcome === "failed" || runOutcome === "error"
    ? "failed"
    : "success";
}

// What a run was dispatched WITH — the facts the handlers need that the event does not carry.
export interface DispatchFacts {
  taskType: string;
  targetRepo: string;
  branch: string;
  description: string;
}

// Recover a run's dispatch facts from what was written down (run row, recorded AT dispatch, then the backing task) — these used to be read off `Agent.spec`, the one copy that only exists in the cluster that ran it, only until the prune.
type DispatchRun = {
  blueprintName: string;
  repo: string;
  branch: string | null;
  args: Record<string, unknown>;
};

/** Not a named type: its members would otherwise restate the tasks table's columns outside libs/shared/src/models/. */
function dispatchFactsFromTask(task: {
  task_type: string;
  target_repo: string;
  target_branch?: string | null;
  description: string;
  context_bundle?: Record<string, unknown> | null;
}): DispatchFacts {
  // `context_bundle.branch` first: a revision task is dispatched onto the branch it names, while `target_branch` is only written once a PR exists.
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

function dispatchFactsFromRun(run: DispatchRun): DispatchFacts {
  return {
    taskType: run.blueprintName,
    targetRepo: run.repo,
    branch: run.branch ?? "",
    description: String(run.args.description ?? ""),
  };
}

export function dispatchFacts(
  run: DispatchRun | null,
  task: Parameters<typeof dispatchFactsFromTask>[0] | null,
): DispatchFacts | null {
  if (run) {
    return dispatchFactsFromRun(run);
  }

  return task ? dispatchFactsFromTask(task) : null;
}
