/** Maps an assembly-line row + node walk rows to a GitHub check run on its pull request (keyed off `args.pr_number`), which also blocks merge while `in_progress` if the repo makes it a required status check. */

import type {
  AssemblyRunsPort,
  StationRunRecord,
  AssemblyRunRecord,
} from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { CheckRunInput } from "@re-cinq/lore-shared/project/lib/github-port.js";
import type { PullRef } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import {
  checkDisplayName,
  loreCheckName,
} from "@re-cinq/lore-shared/project/pulls/check-runs.js";
import { writeAuditLog } from "../../outbound/audit.js";
import { projectFor } from "../../outbound/project-boot.js";
import { isFailureOutcome } from "./notify-failure.js";
import {
  isReviewDefinition,
  REVIEW_RERUN_HINT,
} from "@re-cinq/lore-shared/review/review-definitions.js";

/** The repo-bound surfaces a publish reads and writes through. */
export interface CheckPorts {
  repo: { upsertCheckRun(input: CheckRunInput): Promise<void> };
  pulls: { get(number: number): Promise<PullRef | null> };
  assemblyRuns: Pick<AssemblyRunsPort, "mergeArgs">;
}

/** Runs whose pull request outlives any one commit: every round pushes, so the check follows the PR's live head instead of an `args.head_sha` stamped at start. */
const HEAD_FOLLOWING_BLUEPRINTS = new Set(["implementation-loop"]);

function followsPrHead(line: AssemblyRunRecord): boolean {
  return HEAD_FOLLOWING_BLUEPRINTS.has(line.blueprintName);
}

/** Where a check lands and what it links to. */
export interface CheckContext {
  uiUrl?: string;
  /** The pull request's current head, read only for runs that follow it. */
  liveHeadSha?: string | null;
}

export function assemblyLineCheck(
  line: AssemblyRunRecord,
  nodes: readonly StationRunRecord[],
  context: CheckContext = {},
): CheckRunInput | null {
  const prNumber = Number(line.args.pr_number);
  const headSha = checkHeadSha(line, context.liveHeadSha);

  if (!prNumber || !headSha) {
    return null;
  }

  return {
    ...checkIdentity(line, headSha, context.uiUrl),
    ...checkState(line, nodes),
  };
}

function checkHeadSha(
  line: AssemblyRunRecord,
  liveHeadSha: string | null | undefined,
): string {
  if (followsPrHead(line)) {
    return liveHeadSha ?? "";
  }

  return typeof line.args.head_sha === "string" ? line.args.head_sha : "";
}

/** The fields that name the check run and point back at the run page. */
function checkIdentity(
  line: AssemblyRunRecord,
  headSha: string,
  uiUrl?: string,
): Pick<CheckRunInput, "headSha" | "name" | "title" | "detailsUrl"> {
  return {
    headSha,
    name: loreCheckName(line.blueprintName),
    title: `Lore ${checkDisplayName(line.blueprintName)}`,
    ...(uiUrl ? { detailsUrl: `${uiUrl}/assembly-runs/${line.id}` } : {}),
  };
}

/** Whether the check is still running, and what it concluded once it is not. */
function checkState(
  line: AssemblyRunRecord,
  nodes: readonly StationRunRecord[],
): Pick<CheckRunInput, "status" | "conclusion" | "summary"> {
  if (line.status === "queued" || line.status === "running") {
    return { ...runningText(line, nodes), status: "in_progress" };
  }

  return { ...terminal(line, nodes), status: "completed" };
}

/** A running check names the step in flight, so the PR's checks list reads as the run's progress. */
function runningText(
  line: AssemblyRunRecord,
  nodes: readonly StationRunRecord[],
): Pick<CheckRunInput, "summary"> & Partial<Pick<CheckRunInput, "title">> {
  const running = `Running — ${line.blueprintName}.`;
  const step = nodes.filter((node) => node.outcome === null).at(-1);

  if (!step) {
    return { summary: running };
  }
  const description = line.graph?.nodes.find(
    (node) => node.id === step.nodeId,
  )?.description;
  const at = `Now at \`${step.nodeId}\` (visit ${step.iteration})`;

  return {
    ...(description ? { title: description } : {}),
    summary: `${running}\n\n${at}${description ? `: ${description}` : "."}`,
  };
}

type TerminalResult = {
  conclusion: NonNullable<CheckRunInput["conclusion"]>;
  summary: string;
};

function terminal(
  line: AssemblyRunRecord,
  nodes: readonly StationRunRecord[],
): TerminalResult {
  const failure = failureResult(line);

  if (failure) {
    return failure;
  }

  if (line.outcome === "pr_closed") {
    return { conclusion: "cancelled", summary: "PR closed." };
  }

  if (!isReviewDefinition(line.blueprintName)) {
    return { conclusion: "success", summary: "Finished." };
  }

  if (hasChangesRequested(line, nodes)) {
    return {
      conclusion: "neutral",
      summary:
        "Changes suggested — reply to a review comment to apply, or push a fix.",
    };
  }

  return { conclusion: "success", summary: "Approved." };
}

// Key on outcome, not status: `outcome: "failed"` still closes the row as `finished`, so any non-benign outcome publishes a red check.
function failureResult(line: AssemblyRunRecord): TerminalResult | null {
  if (!isFailureOutcome(line.outcome ?? "")) {
    return null;
  }
  const why = line.reason ? ` — ${line.reason}` : "";
  const rerunHint = isReviewDefinition(line.blueprintName)
    ? ` ${REVIEW_RERUN_HINT}`
    : "";

  return {
    conclusion: "failure",
    summary: `${line.blueprintName} failed${why}.${rerunHint}`,
  };
}

// The code-review walk routes `changes_requested` → done, so the LINE outcome reads "completed" — read the verdict from the node rows instead (latest iteration wins), or the check misreads "Approved.".
function hasChangesRequested(
  line: AssemblyRunRecord,
  nodes: readonly StationRunRecord[],
): boolean {
  return (
    line.outcome === "changes_requested" ||
    latestNodeOutcomes(nodes).includes("changes_requested")
  );
}

function latestNodeOutcomes(nodes: readonly StationRunRecord[]): string[] {
  const latest = new Map<string, StationRunRecord>();

  for (const node of nodes) {
    const prev = latest.get(node.nodeId);

    if (!prev || node.iteration > prev.iteration) {
      latest.set(node.nodeId, node);
    }
  }

  return [...latest.values()].map((node) => node.outcome ?? "");
}

/** The check a run left on the head it last published to, closed now that the pull request has moved on — otherwise every earlier commit keeps a check in progress forever. */
export function supersededCheck(
  line: AssemblyRunRecord,
  check: CheckRunInput,
): CheckRunInput | null {
  const previous = line.args.pr_check_sha;

  if (typeof previous !== "string" || previous === check.headSha) {
    return null;
  }

  return {
    ...check,
    headSha: previous,
    status: "completed",
    conclusion: "neutral",
    title: "Superseded",
    summary: `The pull request moved on to ${check.headSha}; this run reports there now.`,
  };
}

/** Publishes the run's check on its pull request, if it has one. Never throws: the check is a view of the walk, not part of it. */
export async function publishRunCheck(
  assemblyRunId: string,
  assemblyRuns: Pick<
    AssemblyRunsPort,
    "getById" | "listStationRuns" | "mergeArgs"
  >,
): Promise<void> {
  try {
    const [line, nodes] = await Promise.all([
      assemblyRuns.getById(assemblyRunId),
      assemblyRuns.listStationRuns(assemblyRunId),
    ]);

    if (!line || !(Number(line.args.pr_number) > 0)) {
      return;
    }
    const project = await projectFor(line.repo);

    await publishPrCheck(
      { repo: project.repo, pulls: project.pulls, assemblyRuns },
      line,
      nodes,
      process.env.LORE_UI_URL,
    );
  } catch (err) {
    console.warn(
      `[pr-check] run ${assemblyRunId} not published:`,
      (err as Error).message,
    );
  }
}

/** Best-effort publish — a check failure (e.g. missing `checks: write`) never fails the line. */
export async function publishPrCheck(
  ports: CheckPorts,
  line: AssemblyRunRecord,
  nodes: readonly StationRunRecord[],
  uiUrl?: string,
): Promise<void> {
  try {
    await publishCurrentCheck(ports, line, nodes, uiUrl);
  } catch (err) {
    await recordPublishFailure(
      line,
      loreCheckName(line.blueprintName),
      err as Error,
    );
  }
}

/** Closes the previous head's check when the head moved, publishes on the current one, and remembers which head that was. */
async function publishCurrentCheck(
  ports: CheckPorts,
  line: AssemblyRunRecord,
  nodes: readonly StationRunRecord[],
  uiUrl?: string,
): Promise<void> {
  const liveHeadSha = await liveHeadShaOf(ports, line);
  const check = assemblyLineCheck(line, nodes, { uiUrl, liveHeadSha });

  if (!check) {
    return;
  }
  const superseded = supersededCheck(line, check);

  if (superseded) {
    await ports.repo.upsertCheckRun(superseded);
  }
  await ports.repo.upsertCheckRun(check);

  if (liveHeadSha && line.args.pr_check_sha !== liveHeadSha) {
    await ports.assemblyRuns.mergeArgs(line.id, { pr_check_sha: liveHeadSha });
  }
}

/** The pull request's head right now — read only for runs whose check follows it. */
async function liveHeadShaOf(
  ports: CheckPorts,
  line: AssemblyRunRecord,
): Promise<string | null> {
  if (!followsPrHead(line)) {
    return null;
  }
  const pr = await ports.pulls.get(Number(line.args.pr_number));

  return pr?.headSha ?? null;
}

/** Non-fatal but never silent: "Resource not accessible by integration" means the App is missing `checks`, so the merge gate is absent, not clean. */
async function recordPublishFailure(
  line: AssemblyRunRecord,
  checkRunName: string,
  err: Error,
): Promise<void> {
  console.error("[pr-check] publish failed:", err.message);
  await writeAuditLog({
    event_type: "pr_check_publish_failed",
    repo: line.repo,
    payload: {
      assembly_run_id: line.id,
      definition: line.blueprintName,
      check: checkRunName,
      error: err.message,
    },
  });
}
