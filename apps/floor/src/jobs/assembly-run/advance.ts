// Shared IO orchestration for the event-driven walk (spec 6-dark-factory FR6): re-derives "what happens next" purely from persisted node rows; no walker process, so duplicate advancers converge on the unique (line, node, iteration) row.

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { resolveRequiredTags } from "@re-cinq/lore-shared/project/cluster-agents/required-tags.js";
import type {
  AssemblyRunsPort,
  AssemblyRunRecord,
} from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import {
  isHumanStation,
  nodeFailureReason,
  getNextTransition,
  type AssemblyLine,
  type NodeVisit,
  type NodeResult,
  type StageOutcome,
} from "@re-cinq/lore-assembly-lines";
import { resolveRunGraph, selectEdge } from "@re-cinq/lore-assembly-lines";
import type { RunGraphNode } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import { nodeStationFor } from "@re-cinq/lore-stations";

/** True when this node type's station runs in the pooled service, not a pod. */
const isServiceNode = (nodeType: string): boolean =>
  nodeStationFor(nodeType)?.manifest.triggers.some(
    (t) => t.kind === "node" && t.runtime === "service",
  ) === true;

import {
  nodeAgentName,
  stationNodeParams,
  stationRunInputFor,
  type FloorAssemblyRunTask,
} from "./floor-assembly-run.js";
import {
  SERVICE_NODE_EVENT,
  serviceNodeDedupeKey,
} from "@re-cinq/lore-shared/project/events/service-node-event.js";
import { lineWritesOwnEpisode } from "./run-episode.js";
import { isFailureOutcome } from "./notify-failure.js";
import {
  incomingFailureOf,
  nodeLaunchSpec,
  priorFailuresOf,
  priorOutcomeOf,
  resolveNodeDispatch,
  type PriorFailure,
  type ResolveConversationFn,
} from "./launch-spec.js";
import {
  decideMarkReady,
  decidePrStamp,
  decideStampFailure,
  emptyBranchReason,
} from "./spec-pr.js";

export interface AdvanceDeps {
  assemblyRuns: AssemblyRunsPort;
  /** Fallback only: a run stamped since FR6.38 carries its own graph; this covers rows that predate the clone. Delete once no open run lacks a graph. */
  definitions: () => Promise<ReadonlyMap<string, AssemblyLine>>;
  /** Raw `lore.repos.settings`, source of `station_default_tags` for `resolveRequiredTags` (FR2); null repo row means "no default". */
  repoSettings: (repo: string) => Promise<Record<string, unknown> | null>;
  /** Catalog base name, project-qualified when the repo overrides it (bare-name collision let repos replace each other's recipe); optional seam, absent means bare/org-default. */
  qualifyStationRef?: (baseRef: string, repo: string) => Promise<string>;
  resolvePrompt: (promptRef: string, description: string) => string;
  /** Post-close hook for the implementation loop's driver; winning finisher only, best-effort, optional seam like notifyFailure. */
  onRunClosed?(
    run: AssemblyRunRecord,
    outcome: string,
    reason?: string,
  ): Promise<void>;
  /** Reclaim the run's per-task token once the line is terminal. */
  cleanupToken: (runTaskId: string) => Promise<void>;
  /** React to a node FINISHING (CR event, reaper resolve, or `assembly_run.resume`), passed RESOLVED so a reaction can read its TYPE rather than compare hardcoded ids. Injected so this module keeps importing only its own folder. */
  onNodeFinished?: (
    row: AssemblyRunRecord,
    node: RunGraphNode,
    result: NodeResult,
  ) => Promise<void>;
  /** Publish a `runtime: "service"` node for the pooled service to claim instead of a pod; it reports back over `assembly_run.resume`. Optional seam — a composition without it never dispatches a service node, and the reaper times it out. */
  publishNode?: (event: {
    eventName: string;
    params: Record<string, unknown>;
    dedupeKey?: string;
  }) => Promise<void>;
  /** Writes the run's episode here (the `retrospective` station's job, which never runs — every blueprint names it as EXIT and the walk finishes AT exit without dispatching it). Optional seam, like notifyFailure. */
  recordRunEpisode?: (
    run: AssemblyRunRecord,
    outcome: string,
    reason: string | undefined,
  ) => Promise<void>;
  /** Detection-line bookkeeping: close the `args.job_run_id` pipeline.job_runs row the fan-out pre-created, with the line's terminal state. */
  jobRuns: {
    complete(runId: string, resultSummary: string): Promise<unknown>;
    fail(runId: string, reason: string): Promise<unknown>;
  };
  /** User-facing failure notification (Slack + PR comment), fired once per line by the winning finisher; optional seam. */
  notifyFailure?: (
    assemblyRun: AssemblyRunRecord,
    outcome: string,
    reason?: string,
  ) => Promise<void>;
  /** Resolve a node's `continues` declaration to the conversation this run should continue/save as; optional seam, absent means never continues (pre-feature behaviour). */
  resolveConversation?: ResolveConversationFn;
  /** Close the line's backing pipeline task (and, for a planning round, its feature iteration) so a failed line stops reading "still running" downstream; optional seam, same as notifyFailure. */
  settleTask?: (
    assemblyRun: AssemblyRunRecord,
    outcome: string,
    reason?: string,
  ) => Promise<void>;
  /** Account-wide LLM outage stop button, consulted BEFORE a station-run row is minted so a blocked node parks with no row/CR and the reaper re-drives later; optional seam. */
  llmGate?: {
    isBlocked(): boolean;
    trip(failureClass: string, detail?: string): boolean;
  };
  /** Ensure the `push` node's PR exists and is recorded on the line (`args.pr_number`), moving it to `pr-open` — nothing else does, since the push recipe's watcher ignores assembly-line CRs. Optional seam. */
  stampPr?: (assemblyRun: AssemblyRunRecord) => Promise<void>;
  /** Update the run's PR from its description artifact and take it out of draft (Floor-side — the pod has no `gh`/GitHub token); the finishing node's result carries the `Lore-Issue-Coverage` verdict deciding Closes-vs-Refs. */
  markPrReady?: (
    assemblyRun: AssemblyRunRecord,
    result: NodeResult,
  ) => Promise<void>;
}

/** A walk failed overall if any node failed on the way, even though every definition routes `failed` edges toward exit — "completed" would otherwise render a green check over a failed review. */
export function lineOutcomeFromVisits(visits: NodeVisit[]): {
  outcome: "completed" | "failed";
  reason?: string;
} {
  // The LAST unrecovered failure decides the line — run 52c3fdd5 blamed a retried-and-recovered node instead of the failure that actually routed the walk out.
  const unrecovered = visits.filter(
    (visit, index) =>
      visitFailed(visit.outcome) && !recoveredLater(visits, visit, index),
  );
  const failed = unrecovered[unrecovered.length - 1];

  // Degrades to the old `node "<id>" failed` wording for rows written before migration 0042 (no classification).
  return failed
    ? { outcome: "failed", reason: nodeFailureReason(failed) }
    : { outcome: "completed" };
}

/** True when a later visit of the same node closed non-failed — the retry edge worked, so this failure is history, not the line's verdict. */
function recoveredLater(
  visits: NodeVisit[],
  visit: NodeVisit,
  index: number,
): boolean {
  return visits
    .slice(index + 1)
    .some(
      (later) =>
        later.nodeId === visit.nodeId &&
        later.outcome !== null &&
        !visitFailed(later.outcome),
    );
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
export function taskFromAssemblyRun(
  assemblyRun: AssemblyRunRecord,
): FloorAssemblyRunTask {
  return {
    taskId: assemblyRun.taskId ?? assemblyRun.id,
    pipelineTaskId: assemblyRun.taskId,
    assemblyLineId: assemblyRun.id,
    taskType: assemblyRun.blueprintName,
    description: String(assemblyRun.args.description ?? ""),
    targetRepo: assemblyRun.repo,
    branch: assemblyRun.branch ?? "",
    args: assemblyRun.args,
  };
}

/** Cap on fork-chain depth read for prior-failure context — a run forked many times over carries diminishing history at growing read cost. */
const MAX_FORK_HOPS = 5;

/** The launched node's earlier failed attempts, oldest first: the fork chain's (a fork nulls `failure_detail` on its copied prefix rows, so each attempt's failure lives only on its source run), then this run's. */
export async function collectPriorNodeFailures(
  assemblyRun: AssemblyRunRecord,
  nodeId: string,
  visits: ReadonlyArray<{
    nodeId: string;
    iteration: number;
    outcome: string | null;
    failureDetail?: string | null;
  }>,
  deps: Pick<AdvanceDeps, "assemblyRuns">,
): Promise<PriorFailure[]> {
  const chain: PriorFailure[] = [];
  let sourceId = assemblyRun.resumedFromRunId;

  for (let hop = 0; sourceId !== null && hop < MAX_FORK_HOPS; hop++) {
    const sourceRun = await deps.assemblyRuns.getById(sourceId);

    if (!sourceRun) {
      break;
    }
    const sourceRows = await deps.assemblyRuns.listStationRuns(sourceId);

    chain.unshift(...priorFailuresOf(sourceRows, nodeId));
    sourceId = sourceRun.resumedFromRunId;
  }

  return [...chain, ...priorFailuresOf(visits, nodeId)];
}

/** Re-derives the line's next step from its node rows and performs it (launch/finish/fail); safe to call redundantly. */
export async function advanceLine(
  assemblyLineId: string,
  deps: AdvanceDeps,
): Promise<void> {
  const assemblyRun = await deps.assemblyRuns.getById(assemblyLineId);

  if (!assemblyRun || assemblyRun.status !== "running") {
    return;
  }

  const runGraph = await resolveRunGraph(assemblyRun, deps.definitions);

  if (!runGraph) {
    // A single-CR run record (FR6.8) — the agent-watcher owns its lifecycle.
    return;
  }

  const nodes = await deps.assemblyRuns.listStationRuns(assemblyLineId);

  const visits: NodeVisit[] = nodes.map((n) => ({
    nodeId: n.nodeId,
    iteration: n.iteration,
    outcome: n.outcome as StageOutcome | null,
    // Read off the row so the replay survives a Floor restart mid-line.
    failureClass: n.failureClass,
    failureDetail: n.failureDetail,
  }));

  const transition = getNextTransition(runGraph, visits);

  if (transition.kind === "await") {
    return;
  }

  if (transition.kind === "finish" || transition.kind === "fail") {
    const { outcome, reason } =
      transition.kind === "finish"
        ? lineOutcomeFromVisits(visits)
        : { outcome: transition.outcome, reason: transition.reason };

    await finishLine(assemblyRun, outcome, reason, deps);

    return;
  }

  const node = runGraph.nodes.find((n) => n.id === transition.nodeId);

  enforceTrue(
    node,
    Error,
    `AssemblyLine ${runGraph.name}: unknown node "${transition.nodeId}"`,
  );

  // Gated BEFORE the conversation lookup/row/CR: an agent node dispatched into a dry account would boot, install, call the API once, and die — only agent nodes are gated.
  if (node.type === "agent" && deps.llmGate?.isBlocked()) {
    // Logged because parking is otherwise INVISIBLE: this returns void, so the caller cannot distinguish "parked" from "advanced".
    console.log(
      `[llm-dispatch-gate] parked ${assemblyRun.id} at node "${node.id}" — agent dispatch is blocked`,
    );

    return;
  }
  const task = taskFromAssemblyRun(assemblyRun);
  // Resolved BEFORE the row, because the row RECORDS it — otherwise the prompt/round content only exists on a pruned Agent CR.
  const dispatch = await resolveNodeDispatch(
    {
      node,
      task,
      iteration: transition.iteration,
      priorOutcome: priorOutcomeOf(visits, transition.nodeId),
      // How a retried node learns why it is running again instead of repeating itself.
      incomingFailure: incomingFailureOf(visits),
      // Fork chain included; only an agent's prompt reads it, only a fork pays the source-run reads.
      priorFailures:
        node.type === "agent"
          ? await collectPriorNodeFailures(
              assemblyRun,
              transition.nodeId,
              visits,
              deps,
            )
          : undefined,
    },
    deps,
  );
  // Row before CR: a crash between them leaves an open row the reaper resolves by reading the deterministically named CR; the row also MINTS the station-run id so a converged duplicate reuses it. A service node names no CR (null), so the reaper never mistakes it for the crash-between-row-and-launch case and relaunches it as a duplicate pod.
  const runsInService = isServiceNode(node.type);
  // Only a POD node's row parks `queued` for a cluster-agent's claim (FR3) — human/service rows keep `running` and are never claimable.
  const dispatchedAsPod = !isHumanStation(node.type) && !runsInService;
  const { stationRunId, nodeRowId } = await deps.assemblyRuns.ensureStationRun({
    assemblyRunId: assemblyLineId,
    nodeId: node.id,
    iteration: transition.iteration,
    agentCrName: runsInService
      ? null
      : nodeAgentName(assemblyLineId, node.id, transition.iteration),
    input: stationRunInputFor(node, task, dispatch.content, dispatch.prompt),
    status: dispatchedAsPod ? "queued" : undefined,
    requiredTags: dispatchedAsPod
      ? resolveRequiredTags(
          node.type,
          node.required_tags,
          await deps.repoSettings(assemblyRun.repo),
        )
      : undefined,
  });

  // A human station's worker is outside the pod system (wizard/PR page); the row parks the walk, nothing dispatches, and the outcome arrives later as a resume.
  if (isHumanStation(node.type)) {
    return;
  }

  // Published, not launched: the row already exists, so the service has something to report against, and the dedupe key is that row — a redelivered event cannot run the node twice.
  if (runsInService) {
    await deps.publishNode?.({
      eventName: SERVICE_NODE_EVENT,
      dedupeKey: serviceNodeDedupeKey(stationRunId),
      params: {
        stationRunId,
        assemblyLineId,
        nodeId: node.id,
        iteration: transition.iteration,
        nodeType: node.type,
        repo: assemblyRun.repo,
        branch: assemblyRun.branch,
        taskId: assemblyRun.taskId ?? null,
        params: stationNodeParams(node, task),
      },
    });

    return;
  }

  // Arms the queued row with the dispatch spec for a cluster-agent to claim (FR3) instead of pushing to a single one; written AFTER ensureStationRun so only armed rows are claimable.
  const spec = nodeLaunchSpec(dispatch, {
    node,
    task,
    iteration: transition.iteration,
    stationRunId,
    priorOutcome: priorOutcomeOf(visits, transition.nodeId),
    incomingFailure: incomingFailureOf(visits),
  });

  // Points the CR at the catalog spelling this repo actually gets (qualified vs bare org default), resolved at enqueue time so the claiming cluster needs no catalog knowledge.
  if (deps.qualifyStationRef) {
    spec.stationRef = await deps.qualifyStationRef(
      spec.stationRef ?? task.taskType,
      task.targetRepo,
    );
  }

  await deps.assemblyRuns.enqueueStationRunDispatch(nodeRowId, spec);
}

/** Complete only on completed/lease_held; fail everything else, so a future fail outcome added to Transition can never record a failed run as complete. */
async function settleJobRun(
  jobRunId: string,
  assemblyRun: AssemblyRunRecord,
  outcome: string,
  reason: string | undefined,
  deps: AdvanceDeps,
): Promise<void> {
  if (outcome === "completed") {
    await deps.jobRuns.complete(
      jobRunId,
      `station run: ${assemblyRun.blueprintName}:${assemblyRun.repo} ${outcome}`,
    );

    return;
  }

  if (outcome === "lease_held") {
    await deps.jobRuns.complete(jobRunId, `skipped: ${reason}`);

    return;
  }
  await deps.jobRuns.fail(jobRunId, reason ?? outcome);
}

/** Close the row, reclaim the token, and settle the detect fan-out's job_run. */
export async function finishLine(
  assemblyRun: AssemblyRunRecord,
  outcome: string,
  reason: string | undefined,
  deps: AdvanceDeps,
): Promise<void> {
  const jobRunId = assemblyRun.args.job_run_id;

  // Settled BEFORE closing the row: after the row closes, advanceLine's retry early-returns on the terminal row, orphaning the job_run open forever.
  if (typeof jobRunId === "string" && jobRunId.length > 0) {
    await settleJobRun(jobRunId, assemblyRun, outcome, reason, deps);
  }

  const closedNow = await deps.assemblyRuns.finish(
    assemblyRun.id,
    outcome,
    reason,
  );

  // finish is first-writer-wins — a losing racer still reaches here, so cleanupToken MUST be idempotent (cleanupPerTaskToken swallows 404s).
  await deps.cleanupToken(assemblyRun.taskId ?? assemblyRun.id);

  // Telemetry only, swallowed on failure like maybeStampPr — an unwritten episode is still a finished run. Winner-gated like every side effect below — an event-vs-reaper race can otherwise write one run's episode twice.
  if (
    closedNow &&
    deps.recordRunEpisode &&
    !lineWritesOwnEpisode(assemblyRun.graph)
  ) {
    try {
      await deps.recordRunEpisode(assemblyRun, outcome, reason);
    } catch (err) {
      console.warn(
        `[assembly-run] episode for ${assemblyRun.id} not recorded:`,
        (err as Error).message,
      );
    }
  }

  // Without this a line-backed task stays `running` forever — the watcher's post-completion path returns early for node CRs.
  if (closedNow && deps.settleTask) {
    await deps.settleTask(assemblyRun, outcome, reason);
  }

  if (closedNow && deps.onRunClosed) {
    try {
      await deps.onRunClosed(assemblyRun, outcome, reason);
    } catch (err) {
      console.error("[on-run-closed] hook threw:", (err as Error).message);
    }
  }

  // Only the winning finisher tells the user — losers would duplicate the Slack message and PR comment.
  if (closedNow && isFailureOutcome(outcome) && deps.notifyFailure) {
    try {
      await deps.notifyFailure(assemblyRun, outcome, reason);
    } catch (err) {
      console.error("[notify-failure] notifier threw:", (err as Error).message);
    }
  }
}

/** Record one node's terminal outcome (CAS — first writer decides) and advance the line; `iteration` targets the exact revisit whose CR fired so a late duplicate event can't overwrite the current one. */
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

  // `false`/undefined target both mean another delivery already closed this node — its follow-up ALREADY fired, so firing it again would re-route a result that was just routed.
  const closedHere =
    target !== undefined &&
    (await deps.assemblyRuns.finishStationRunOnce(
      target.id,
      input.result.outcome,
      undefined,
      {
        failureClass: input.result.failureClass,
        failureDetail: input.result.failureDetail,
      },
    ));

  // Once-only effects are CAS-gated; the walk is not — advanceLine re-derives its step from the node rows, so re-running it recovers a delivery that closed the node then died before advancing.
  if (closedHere) {
    await maybeStampPr(input.assemblyLineId, input.nodeId, input.result, deps);
    await maybeMarkPrReady(
      input.assemblyLineId,
      input.nodeId,
      input.result,
      deps,
    );
    await reactToNodeFinished(
      input.assemblyLineId,
      input.nodeId,
      input.result,
      deps,
    );
  }

  await advanceLine(input.assemblyLineId, deps);
}

/** Runs the node-finished reaction and never lets it stop the walk — same bias as `maybeStampPr`: a failed follow-up is a log line, not a permanently parked run. */
async function reactToNodeFinished(
  assemblyLineId: string,
  nodeId: string,
  result: NodeResult,
  deps: AdvanceDeps,
): Promise<void> {
  if (!deps.onNodeFinished) {
    return;
  }

  try {
    const row = await deps.assemblyRuns.getById(assemblyLineId);
    const node = row
      ? (await resolveRunGraph(row, deps.definitions))?.nodes.find(
          (candidate) => candidate.id === nodeId,
        )
      : undefined;

    // A node the graph does not know is a wiring bug (snapshot graph disagrees with the finished id) — logged rather than silently dropped, since silence is the exact failure this hook was re-keyed to prevent.
    if (row && !node) {
      console.warn(
        `[assembly-run] ${assemblyLineId}: node ${nodeId} is not in the run's graph — node-finished reaction skipped`,
      );
    }

    if (row && node) {
      await deps.onNodeFinished(row, node, result);
    }
  } catch (err) {
    console.warn(
      `[assembly-run] node-finished reaction failed for ${nodeId}:`,
      (err as Error).message,
    );
  }
}

/** Flips the PR out of draft when the finished step hands off to the human wait; never fails the run — a draft PR is recoverable, discarding finished work is not. */
async function maybeMarkPrReady(
  assemblyLineId: string,
  nodeId: string,
  result: NodeResult,
  deps: AdvanceDeps,
): Promise<void> {
  if (!deps.markPrReady) {
    return;
  }
  const assemblyRun = await deps.assemblyRuns.getById(assemblyLineId);

  if (!assemblyRun) {
    return;
  }

  try {
    const graph = await resolveRunGraph(assemblyRun, deps.definitions);
    const node = graph?.nodes.find((n) => n.id === nodeId);
    const next = node
      ? selectEdge(graph!, nodeId, result.outcome)?.to
      : undefined;

    if (
      !decideMarkReady({
        outcome: result.outcome,
        nextNodeType: graph?.nodes.find((n) => n.id === next)?.type,
        args: assemblyRun.args,
      })
    ) {
      return;
    }

    await deps.markPrReady(assemblyRun, result);
    // Written AFTER the flip so a fix-ci round-trip doesn't rewrite the PR body twice; a crash between the two costs one redundant idempotent flip.
    await deps.assemblyRuns.mergeArgs(assemblyLineId, {
      pr_ready_flipped: true,
    });
  } catch (err) {
    console.error("[spec-pr] mark-ready failed:", (err as Error).message);
  }
}

/** Stamps the PR from the `push` node's result; never throws for a transient failure (the reaper re-drives), but an EMPTY branch (#1330) fails the line instead — otherwise the wait node downstream parks forever on a PR that cannot exist. */
async function maybeStampPr(
  assemblyLineId: string,
  nodeId: string,
  result: NodeResult,
  deps: AdvanceDeps,
): Promise<void> {
  if (!deps.stampPr) {
    return;
  }
  const assemblyRun = await deps.assemblyRuns.getById(assemblyLineId);

  if (!assemblyRun) {
    return;
  }

  try {
    const node = (
      await resolveRunGraph(assemblyRun, deps.definitions)
    )?.nodes.find((n) => n.id === nodeId);

    if (
      !decidePrStamp({
        promptRef: node?.prompt_ref,
        outcome: result.outcome,
        args: assemblyRun.args,
      })
    ) {
      return;
    }

    await deps.stampPr(assemblyRun);
  } catch (err) {
    const message = (err as Error).message;

    console.error("[spec-pr] stamp failed:", message);

    if (decideStampFailure(message) === "empty-branch") {
      await finishLine(
        assemblyRun,
        "error",
        emptyBranchReason(assemblyRun.branch),
        deps,
      );
    }
  }
}
