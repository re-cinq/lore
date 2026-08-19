// The event-driven walk's shared IO orchestration (spec 6-dark-factory FR6): every
// node-terminal event (or reaper-synthesized timeout) records the node's outcome and
// re-derives "what happens next" purely from the persisted node rows (nextTransition).
// There is no walker process — a Floor restart loses nothing; duplicate/concurrent
// advancers converge on the UNIQUE (line, node, iteration) row and the 409-idempotent
// CR create.

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { LoreTaskSpec } from "@re-cinq/lore-shared";
import type {
  AssemblyRunsPort,
  AssemblyRunRecord,
} from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import {
  isHumanStation,
  nextTransition,
  type AssemblyLine,
  type NodeVisit,
  type NodeResult,
  type StageOutcome,
} from "@re-cinq/lore-assembly-lines";
import { graphForRun } from "@re-cinq/lore-assembly-lines";
import type { RunGraphNode } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import {
  nodeAgentName,
  nodeAgentSpec,
  nodeStationSpec,
  type FloorAssemblyRunTask,
} from "./floor-assembly-run.js";
import { isFailureOutcome } from "./notify-failure.js";
import { roundContent } from "./round-content.js";
import {
  decidePrStamp,
  decideStampFailure,
  emptyBranchReason,
} from "./spec-pr.js";

export interface AdvanceDeps {
  assemblyRuns: AssemblyRunsPort;
  /**
   * The loaded builtin blueprints — the FALLBACK only. A run stamped since
   * FR6.38 carries its own graph and the walk reads that, so this is consulted
   * for rows that predate the clone (and to decide, for a row with neither, that
   * it is a single-CR record the agent-watcher owns). Delete once no open run
   * lacks a graph.
   */
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
    row: AssemblyRunRecord,
    outcome: string,
    reason?: string,
  ) => Promise<void>;
  /** Resolve a node's `continues` declaration into the conversation this run should
   *  continue and save as. Optional seam — a composition without it simply never
   *  continues, which is the pre-feature behaviour. */
  resolveConversation?: (
    node: RunGraphNode,
    task: FloorAssemblyRunTask,
    iteration: number,
    priorOutcome: string | null,
  ) => Promise<LoreTaskSpec["conversation"] | undefined>;
  /** Close the line's backing pipeline task — and, for a planning round, its feature
   *  iteration — so a failed line stops reading as "still running" everywhere
   *  downstream. Optional seam, same as notifyFailure. */
  settleTask?: (
    row: AssemblyRunRecord,
    outcome: string,
    reason?: string,
  ) => Promise<void>;
  /** Ensure the PR the `push` node produced exists and is recorded on the line
   *  (`args.pr_number`), moving a feature-carrying line to `pr-open`. Nothing else
   *  does it: the push recipe defers to a watcher that ignores assembly-line CRs.
   *  Optional seam, same as notifyFailure. */
  stampPr?: (row: AssemblyRunRecord) => Promise<void>;
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

/** The outcome of a node's most recent recorded visit, or null if it has never run.
 *  Distinguishes a retry (its own last attempt failed) from a next round. */
function priorOutcomeOf(visits: NodeVisit[], nodeId: string): string | null {
  const own = visits.filter((v) => v.nodeId === nodeId);

  return own.length ? (own[own.length - 1].outcome ?? null) : null;
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
export function taskFromRow(row: AssemblyRunRecord): FloorAssemblyRunTask {
  return {
    taskId: row.taskId ?? row.id,
    pipelineTaskId: row.taskId,
    assemblyLineId: row.id,
    taskType: row.blueprintName,
    description: String(row.args.description ?? ""),
    targetRepo: row.repo,
    branch: row.branch ?? "",
    args: row.args,
  };
}

/** Re-derive the line's next step from its node rows and perform it: launch the next
 *  node CR, finish the row, or fail it. Safe to call redundantly — no-ops unless the
 *  replay says there is something to do. */
export async function advanceLine(
  assemblyLineId: string,
  deps: AdvanceDeps,
): Promise<void> {
  const row = await deps.assemblyRuns.getById(assemblyLineId);

  if (!row || row.status !== "running") {
    return;
  }

  const graph = await graphForRun(row, deps.definitions);

  if (!graph) {
    // A single-CR run record (FR6.8) — the agent-watcher owns its lifecycle.
    return;
  }

  const nodes = await deps.assemblyRuns.listStationRuns(assemblyLineId);

  const visits: NodeVisit[] = nodes.map((n) => ({
    nodeId: n.nodeId,
    iteration: n.iteration,
    outcome: n.outcome as StageOutcome | null,
  }));
  const transition = nextTransition(graph, visits);

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

  const node = graph.nodes.find((n) => n.id === transition.nodeId);

  enforceTrue(
    node,
    Error,
    `AssemblyLine ${graph.name}: unknown node "${transition.nodeId}"`,
  );
  const task = taskFromRow(row);
  // Resolved BEFORE the prompt: whether this run resumes a conversation decides how
  // much round content the prompt must carry. Only agent nodes hold one — a station
  // runs a deterministic command.
  const conversation =
    node.type === "agent" && deps.resolveConversation
      ? await deps.resolveConversation(
          node,
          task,
          transition.iteration,
          priorOutcomeOf(visits, transition.nodeId),
        )
      : undefined;
  // The round content BOTH fields carry. The recipe the pod runs renders
  // {description}, so setting only the prompt hands a resumed round the full draft
  // again — and the two disagreeing about what this run is working from is a bug in
  // either direction.
  const content = roundContent(task, conversation);
  // Row before CR: a crash in between leaves an open row the reaper resolves by
  // reading the (deterministically named) CR; a rowless CR would be invisible.
  // The row is also what MINTS the station-run id — a converged duplicate returns
  // the id already minted, so a re-dispatch of the same visit carries the same
  // label rather than a second identity.
  const { stationRunId } = await deps.assemblyRuns.ensureStationRun({
    assemblyRunId: assemblyLineId,
    nodeId: node.id,
    iteration: transition.iteration,
    agentCrName: nodeAgentName(assemblyLineId, node.id, transition.iteration),
  });

  // Iteration rides into the CR name + labels so a revisited node runs a fresh pod.
  const spec =
    node.type === "agent"
      ? nodeAgentSpec(
          node,
          { ...task, description: content },
          deps.resolvePrompt(node.prompt_ref ?? node.type, content),
          transition.iteration,
          stationRunId,
        )
      : nodeStationSpec(node, task, transition.iteration, stationRunId);

  if (conversation) {
    spec.conversation = conversation;
  }

  // A human station's worker is outside the pod system — a person in the wizard,
  // or a reviewer on the PR page. The row is what parks the walk and lets the graph
  // show whose move it is; nothing is dispatched, and the outcome arrives later as
  // a resume.
  if (isHumanStation(node.type)) {
    return;
  }

  await deps.launch(spec);
}

/** Close the row, reclaim the token, and settle the detect fan-out's job_run. */
export async function finishLine(
  row: AssemblyRunRecord,
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
        `station run: ${row.blueprintName}:${row.repo} ${outcome}`,
      );
    } else if (outcome === "lease_held") {
      await deps.jobRuns.complete(jobRunId, `skipped: ${reason}`);
    } else {
      await deps.jobRuns.fail(jobRunId, reason ?? outcome);
    }
  }

  const closedNow = await deps.assemblyRuns.finish(row.id, outcome, reason);

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
  const nodes = await deps.assemblyRuns.listStationRuns(input.assemblyLineId);
  const forNode = nodes.filter((n) => n.nodeId === input.nodeId);
  const target =
    input.iteration !== undefined
      ? forNode.find(
          (n) => n.iteration === input.iteration && n.outcome === null,
        )
      : forNode.filter((n) => n.outcome === null).at(-1);

  if (target) {
    await deps.assemblyRuns.finishStationRunOnce(
      target.id,
      input.result.outcome,
    );
  }

  await maybeStampPr(input.assemblyLineId, input.nodeId, input.result, deps);
  await advanceLine(input.assemblyLineId, deps);
}

/** Record the PR a successful `push` node produced, before the walk moves on.
 *
 *  Runs here rather than inside `advanceLine` because it is a reaction to a node
 *  FINISHING — advanceLine is also driven by the start handler and the reaper,
 *  where nothing just pushed. It never throws: a line whose stamp failed for a
 *  transient reason is worth advancing anyway, and the reaper re-drives it.
 *
 *  An EMPTY branch is not transient, and is the one case that must not be
 *  swallowed (#1330): the node reported success having pushed nothing, so the
 *  wait node downstream would park forever on a PR that cannot exist. The line
 *  is failed with a reason instead, which `advanceLine` then declines to walk
 *  (it only advances a `running` row) and `settleTask` puts in front of the
 *  author. */
async function maybeStampPr(
  assemblyLineId: string,
  nodeId: string,
  result: NodeResult,
  deps: AdvanceDeps,
): Promise<void> {
  if (!deps.stampPr) {
    return;
  }
  const row = await deps.assemblyRuns.getById(assemblyLineId);

  if (!row) {
    return;
  }

  try {
    const node = (await graphForRun(row, deps.definitions))?.nodes.find(
      (n) => n.id === nodeId,
    );

    if (
      !decidePrStamp({
        promptRef: node?.prompt_ref,
        outcome: result.outcome,
        args: row.args,
      })
    ) {
      return;
    }

    await deps.stampPr(row);
  } catch (err) {
    const message = (err as Error).message;

    console.error("[spec-pr] stamp failed:", message);

    if (decideStampFailure(message) === "empty-branch") {
      await finishLine(row, "error", emptyBranchReason(row.branch), deps);
    }
  }
}
