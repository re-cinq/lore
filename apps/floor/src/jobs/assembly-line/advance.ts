// The event-driven walk's shared IO orchestration (spec 6-dark-factory FR6): every
// node-terminal event (or reaper-synthesized timeout) records the node's outcome and
// re-derives "what happens next" purely from the persisted node rows (nextTransition).
// There is no walker process — a Floor restart loses nothing; duplicate/concurrent
// advancers converge on the UNIQUE (line, node, iteration) row and the 409-idempotent
// CR create.

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { LoreTaskSpec } from "@re-cinq/lore-shared";
import type {
  AssemblyLinesPort,
  AssemblyLineRecord,
} from "@re-cinq/lore-shared/project/assembly-lines/assembly-lines-port.js";
import {
  nextTransition,
  type AssemblyLine,
  type NodeVisit,
  type NodeResult,
  type StageOutcome,
} from "@re-cinq/lore-assembly-lines";
import {
  nodeAgentSpec,
  nodeStationSpec,
  type FloorAssemblyLineTask,
} from "./floor-assembly-line.js";
import { isFailureOutcome } from "./notify-failure.js";

export interface AdvanceDeps {
  assemblyLines: AssemblyLinesPort;
  /** The loaded builtin assembly line YAMLs — the walk's transition table. */
  definitions: () => Promise<ReadonlyMap<string, AssemblyLine>>;
  /** Dispatch one node's Agent CR (agentCrBackend().launch — 409 is a no-op). */
  launch: (spec: LoreTaskSpec) => Promise<void>;
  resolvePrompt: (promptRef: string, description: string) => string;
  /** Reclaim the run's per-task token once the line is terminal. */
  cleanupToken: (runTaskId: string) => Promise<void>;
  /** Detection-line bookkeeping: close the `args.job_run_id` pipeline.job_runs row
   *  with the line's terminal state (the fan-out pre-created it). */
  jobRuns: {
    complete(runId: string, resultSummary: string): Promise<unknown>;
    fail(runId: string, reason: string): Promise<unknown>;
  };
  /** User-facing failure notification (Slack + PR comment), fired once per line by
   *  the winning finisher. Optional seam — tests and partial compositions omit it. */
  notifyFailure?: (
    row: AssemblyLineRecord,
    outcome: string,
    reason?: string,
  ) => Promise<void>;
  /** Close the line's backing pipeline task — and, for a planning round, its feature
   *  iteration — so a failed line stops reading as "still running" everywhere
   *  downstream. Optional seam, same as notifyFailure. */
  settleTask?: (
    row: AssemblyLineRecord,
    outcome: string,
    reason?: string,
  ) => Promise<void>;
}

/** A walk that reached exit still failed as a whole when a node failed on the way
 *  (every definition routes `failed` edges toward exit so the retrospective runs) —
 *  "completed" would render a green check over a failed review. */
export function lineOutcomeFromVisits(visits: NodeVisit[]): {
  outcome: "completed" | "failed";
  reason?: string;
} {
  const failed = visits.find((v) => visitFailed(v.outcome));

  return failed
    ? { outcome: "failed", reason: `node "${failed.nodeId}" failed` }
    : { outcome: "completed" };
}

function visitFailed(outcome: StageOutcome | null): boolean {
  if (outcome === null) {
    return false;
  }

  switch (outcome) {
    case "failed":
      return true;
    case "success":
    case "changes_requested":
      return false;
  }
}

/** The walk task shape, derived from the persisted row instead of an in-memory task. */
export function taskFromRow(row: AssemblyLineRecord): FloorAssemblyLineTask {
  return {
    taskId: row.taskId ?? row.id,
    pipelineTaskId: row.taskId,
    assemblyLineId: row.id,
    taskType: row.definitionName,
    description: String(row.args.description ?? ""),
    targetRepo: row.repo,
    branch: row.branch ?? "",
    args: row.args,
  };
}

// Definitions whose branch is a shared workspace, not a work identity. Every
// comment on a PR rides the PR's head branch, so two of these lines on one branch
// carry DISTINCT human comments — not the duplicate per-repo/per-commit work the
// overlap guard exists to suppress (detect: detect/<def>/<repo>; ingest:
// ingest/<kind>/<sha>[/<chunk>], where the branch encodes the exact unit of
// work — chunked ingest carries its chunk identity precisely so sibling chunks
// never read as duplicates here). Guarding them would
// drop the newer as lease_held and silently lose a comment, so they opt out. They
// then run concurrently: comment-triage commits nothing, and a code-review-reply
// push race fails loudly rather than a comment vanishing without a trace.
// code-review-recheck opts out for the same reason: each push carries a distinct
// diff and it commits nothing, so guarding it would silently drop a verdict update
// — stranding a stale REQUEST_CHANGES that blocks auto-merge while a reply line
// holds the branch — rather than suppress duplicate work.
const BRANCH_SHARED_WORKSPACE = new Set([
  "comment-triage",
  "code-review-reply",
  "code-review-recheck",
]);

/** Re-derive the line's next step from its node rows and perform it: launch the next
 *  node CR, finish the row, or fail it. Safe to call redundantly — no-ops unless the
 *  replay says there is something to do. */
export async function advanceLine(
  assemblyLineId: string,
  deps: AdvanceDeps,
): Promise<void> {
  const row = await deps.assemblyLines.getById(assemblyLineId);

  if (!row || row.status !== "running") {
    return;
  }

  const definition = (await deps.definitions()).get(row.definitionName);

  if (!definition) {
    // A single-CR run record (FR6.8) — the agent-watcher owns its lifecycle.
    return;
  }

  const nodes = await deps.assemblyLines.listNodes(assemblyLineId);

  // Overlap guard (branch-lease parity): a second not-yet-started run on the same
  // repo+branch defers to the one already in flight — the detect fan-out relies on
  // this to suppress duplicate per-repo runs, exactly as the old lease did. It is
  // check-then-act (not atomic like the old lease CTE): two starts in the same
  // drain batch can both markRunning before either reaches here. So defer only to a
  // DETERMINISTICALLY-chosen winner — the one with the smaller row id — so at most
  // one side backs off (a naive "any other running" would make BOTH defer and skip
  // detection for the tick).
  if (
    nodes.length === 0 &&
    row.branch &&
    !BRANCH_SHARED_WORKSPACE.has(row.definitionName)
  ) {
    // Defer only to a strictly-older winner (earlier createdAt, ties broken by id):
    // the single oldest open row on the branch proceeds, all others defer. A stale
    // winner that never progresses is re-driven / failed by the reaper, so it can't
    // wedge the branch permanently.
    const isOlder = (other: AssemblyLineRecord): boolean => {
      const dt = other.createdAt.getTime() - row.createdAt.getTime();

      return dt < 0 || (dt === 0 && other.id < row.id);
    };
    const overlapping = (await deps.assemblyLines.listOpen()).some(
      (other) =>
        other.id !== row.id &&
        (other.status === "queued" || other.status === "running") &&
        other.repo === row.repo &&
        other.branch === row.branch &&
        isOlder(other),
    );

    if (overlapping) {
      await finishLine(
        row,
        "lease_held",
        "another run holds this branch",
        deps,
      );

      return;
    }
  }

  const visits: NodeVisit[] = nodes.map((n) => ({
    nodeId: n.nodeId,
    iteration: n.iteration,
    outcome: n.outcome as StageOutcome | null,
  }));
  const transition = nextTransition(definition, visits);

  if (transition.kind === "await") {
    return;
  }

  if (transition.kind === "finish" || transition.kind === "fail") {
    const { outcome, reason } =
      transition.kind === "finish"
        ? lineOutcomeFromVisits(visits)
        : { outcome: transition.outcome, reason: transition.reason };

    await finishLine(row, outcome, reason, deps);

    return;
  }

  const node = definition.nodes.find((n) => n.id === transition.nodeId);

  enforceTrue(
    node,
    Error,
    `AssemblyLine ${definition.name}: unknown node "${transition.nodeId}"`,
  );
  const task = taskFromRow(row);
  // Iteration rides into the CR name + labels so a revisited node runs a fresh pod.
  const spec =
    node.type === "agent"
      ? nodeAgentSpec(
          node,
          task,
          deps.resolvePrompt(node.prompt_ref ?? node.type, task.description),
          transition.iteration,
        )
      : nodeStationSpec(node, task, transition.iteration);

  // Row before CR: a crash in between leaves an open row the reaper resolves by
  // reading the (deterministically named) CR; a rowless CR would be invisible.
  await deps.assemblyLines.ensureNodeStart({
    assemblyLineId,
    nodeId: node.id,
    iteration: transition.iteration,
    agentCrName: spec.name,
  });
  await deps.launch(spec);
}

/** Close the row, reclaim the token, and settle the detect fan-out's job_run. */
export async function finishLine(
  row: AssemblyLineRecord,
  outcome: string,
  reason: string | undefined,
  deps: AdvanceDeps,
): Promise<void> {
  const jobRunId = row.args.job_run_id;

  // Settle the detect fan-out's job_run BEFORE closing the row: if the row close
  // commits but this step then throws, the event retry's advanceLine early-returns
  // on the now-terminal row and the job_run would orphan open forever. Classify by
  // "complete only on completed/lease_held; fail everything else" so a future fail
  // outcome added to Transition can never record a failed run as complete.
  if (typeof jobRunId === "string" && jobRunId.length > 0) {
    if (outcome === "completed") {
      await deps.jobRuns.complete(
        jobRunId,
        `station run: ${row.definitionName}:${row.repo} ${outcome}`,
      );
    } else if (outcome === "lease_held") {
      await deps.jobRuns.complete(jobRunId, `skipped: ${reason}`);
    } else {
      await deps.jobRuns.fail(jobRunId, reason ?? outcome);
    }
  }

  const closedNow = await deps.assemblyLines.finish(row.id, outcome, reason);

  // finish is first-writer-wins — a losing racer (node event vs reaper re-advance)
  // closes 0 rows yet still reaches here, so cleanupToken MUST be idempotent
  // (cleanupPerTaskToken swallows 404s); the double-reclaim is a harmless no-op.
  await deps.cleanupToken(row.taskId ?? row.id);

  // The winning finisher also settles the backing task. Without this a line-backed
  // task stays `running` with a NULL failure_reason forever — the watcher's
  // post-completion path returns early for node CRs, so nobody else ever closes it.
  if (closedNow && deps.settleTask) {
    await deps.settleTask(row, outcome, reason);
  }

  // Only the winning finisher tells the user — losers would duplicate the Slack
  // message and PR comment. Never let a notification failure poison the close.
  if (closedNow && isFailureOutcome(outcome) && deps.notifyFailure) {
    try {
      await deps.notifyFailure(row, outcome, reason);
    } catch (err) {
      console.error("[notify-failure] notifier threw:", (err as Error).message);
    }
  }
}

/** Record one node's terminal outcome (CAS — the first writer decides; a losing
 *  duplicate advances with the stored outcome) and advance the line. `iteration`
 *  (from the CR's label) targets the exact revisit whose CR fired, so a late
 *  duplicate event for a prior iteration can't overwrite the current one. */
export async function finishNodeAndAdvance(
  input: {
    assemblyLineId: string;
    nodeId: string;
    iteration?: number;
    result: NodeResult;
  },
  deps: AdvanceDeps,
): Promise<void> {
  const nodes = await deps.assemblyLines.listNodes(input.assemblyLineId);
  const forNode = nodes.filter((n) => n.nodeId === input.nodeId);
  const target =
    input.iteration !== undefined
      ? forNode.find(
          (n) => n.iteration === input.iteration && n.outcome === null,
        )
      : forNode.filter((n) => n.outcome === null).at(-1);

  if (target) {
    await deps.assemblyLines.finishNodeOnce(target.id, input.result.outcome);
  }

  await advanceLine(input.assemblyLineId, deps);
}
