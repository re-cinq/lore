// The event-driven walk's shared IO orchestration (spec 6-dark-factory FR6): every
// node-terminal event (or reaper-synthesized timeout) records the node's outcome and
// re-derives "what happens next" purely from the persisted node rows (getNextTransition).
// There is no walker process — a Floor restart loses nothing; duplicate/concurrent
// advancers converge on the UNIQUE (line, node, iteration) row and the 409-idempotent
// CR create.

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

/** Published when a node's station runs in the pooled service rather than a pod.
 *  Subject-first like the rest of the assembly_run family: several producers,
 *  one subject. */

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
  priorOutcomeOf,
  resolveNodeDispatch,
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
  /**
   * The loaded builtin blueprints — the FALLBACK only. A run stamped since
   * FR6.38 carries its own graph and the walk reads that, so this is consulted
   * for rows that predate the clone (and to decide, for a row with neither, that
   * it is a single-CR record the agent-watcher owns). Delete once no open run
   * lacks a graph.
   */
  definitions: () => Promise<ReadonlyMap<string, AssemblyLine>>;
  /** The repo's raw `lore.repos.settings` object — what `resolveRequiredTags`
   *  reads `station_default_tags` from at enqueue time (FR2). Null when the
   *  repo has no row; the resolver treats that as "no default". */
  repoSettings: (repo: string) => Promise<Record<string, unknown> | null>;
  resolvePrompt: (promptRef: string, description: string) => string;
  /** Post-close hook for choreography that re-arms on a run's terminal state
   *  (the implementation loop's driver). Winning finisher only, best-effort —
   *  a throw here never un-finishes the run. Optional seam like notifyFailure. */
  onRunClosed?(
    run: AssemblyRunRecord,
    outcome: string,
    reason?: string,
  ): Promise<void>;
  /** Reclaim the run's per-task token once the line is terminal. */
  cleanupToken: (runTaskId: string) => Promise<void>;
  /**
   * React to a node FINISHING, whichever door reported it.
   *
   * Injected rather than called directly so this module keeps importing only its
   * own folder — the shape `alertBilling` already uses. It is wired once, in
   * `productionNodeEventDeps`, which every door resolves its deps from: the CR
   * event, the reaper's resolve, and a station reporting over `assembly_run.resume`.
   * Routing that lived on ONE door meant a triage node resolved by the reaper
   * silently never started its follow-up.
   */
  /** The node is passed RESOLVED, not by id: a reaction that has to decide
   *  whether this node is the kind it cares about should read its TYPE, and a
   *  bare id leaves it comparing hardcoded strings instead. */
  onNodeFinished?: (
    row: AssemblyRunRecord,
    node: RunGraphNode,
    result: NodeResult,
  ) => Promise<void>;
  /**
   * Publish a node for the pooled service to claim, instead of giving it a pod.
   *
   * A station whose manifest says `runtime: "service"` needs none of what a pod
   * provides — no workspace clone, no per-node identity, no deadline of its own —
   * and a pod per DB write or per HTTP POST is the waste the service form exists
   * to remove. The service reports the outcome back over `assembly_run.resume`,
   * the same channel a person reports through, so the walk converges either way.
   *
   * Optional seam, like notifyFailure: a composition without it simply never
   * dispatches a service node, which the reaper then times out visibly.
   */
  publishNode?: (event: {
    eventName: string;
    params: Record<string, unknown>;
    dedupeKey?: string;
  }) => Promise<void>;
  /**
   * Record what a finished run did, as an episode.
   *
   * This was the `retrospective` station's job and it never ran: every blueprint
   * names retrospective as its EXIT, and the walk finishes AT the exit rather
   * than dispatching it — 248 recorded node visits, none of them a retrospective.
   * So no assembly run has ever written one. It happens here instead, where the
   * run actually ends, which is also where the Floor already does its terminal
   * bookkeeping.
   *
   * Optional seam, like notifyFailure.
   */
  recordRunEpisode?: (
    run: AssemblyRunRecord,
    outcome: string,
    reason: string | undefined,
  ) => Promise<void>;
  /** Detection-line bookkeeping: close the `args.job_run_id` pipeline.job_runs row
   *  with the line's terminal state (the fan-out pre-created it). */
  jobRuns: {
    complete(runId: string, resultSummary: string): Promise<unknown>;
    fail(runId: string, reason: string): Promise<unknown>;
  };
  /** User-facing failure notification (Slack + PR comment), fired once per line by
   *  the winning finisher. Optional seam — tests and partial compositions omit it. */
  notifyFailure?: (
    assemblyRun: AssemblyRunRecord,
    outcome: string,
    reason?: string,
  ) => Promise<void>;
  /** Resolve a node's `continues` declaration into the conversation this run should
   *  continue and save as. Optional seam — a composition without it simply never
   *  continues, which is the pre-feature behaviour. */
  resolveConversation?: ResolveConversationFn;
  /** Close the line's backing pipeline task — and, for a planning round, its feature
   *  iteration — so a failed line stops reading as "still running" everywhere
   *  downstream. Optional seam, same as notifyFailure. */
  settleTask?: (
    assemblyRun: AssemblyRunRecord,
    outcome: string,
    reason?: string,
  ) => Promise<void>;
  /**
   * The factory's stop button for an account-wide LLM outage. Consulted BEFORE a
   * station-run row is minted, so a blocked node parks with no row and no CR and
   * the reaper simply re-drives the line later. Optional seam — a composition
   * without it dispatches exactly as before.
   */
  llmGate?: {
    isBlocked(): boolean;
    trip(failureClass: string, detail?: string): boolean;
  };
  /** Ensure the PR the `push` node produced exists and is recorded on the line
   *  (`args.pr_number`), moving a feature-carrying line to `pr-open`. Nothing else
   *  does it: the push recipe defers to a watcher that ignores assembly-line CRs.
   *  Optional seam, same as notifyFailure. */
  stampPr?: (assemblyRun: AssemblyRunRecord) => Promise<void>;
  /** Update the run's PR from its description artifact and take it out of
   *  draft. Floor-side because the pod has no `gh` and no GitHub token. */
  markPrReady?: (assemblyRun: AssemblyRunRecord) => Promise<void>;
}

/** A walk that reached exit still failed as a whole when a node failed on the way
 *  (every definition routes `failed` edges toward exit so the run settles) —
 *  "completed" would render a green check over a failed review. */
export function lineOutcomeFromVisits(visits: NodeVisit[]): {
  outcome: "completed" | "failed";
  reason?: string;
} {
  const failed = visits.find((v) => visitFailed(v.outcome));

  // `nodeFailureReason` degrades to the old `node "<id>" failed` wording when the
  // visit carries no classification, so rows written before migration 0042 read
  // exactly as they did.
  return failed
    ? { outcome: "failed", reason: nodeFailureReason(failed) }
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

/** Re-derive the line's next step from its node rows and perform it: launch the next
 *  node CR, finish the row, or fail it. Safe to call redundantly — no-ops unless the
 *  replay says there is something to do. */
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
    // The replay decides whether a retry could help, so the class has to travel
    // with the visit — reading it back off the row is what survives a Floor
    // restart mid-line.
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

  // Before ANY of the work below — the conversation lookup, the row, the CR. An
  // agent node dispatched into a dry account is decided before its pod starts:
  // it will boot, install, call the API once, and die. Park it instead. Only
  // agent nodes are gated; a validate or gate station has no model call to fail.
  if (node.type === "agent" && deps.llmGate?.isBlocked()) {
    // Parking is INVISIBLE otherwise: this returns void, so the caller cannot
    // tell "parked" from "advanced", and during an outage an operator gets one
    // gate-trip warning and then silence while runs sit `running` with no open
    // node. Naming the run and the node is what answers "which ones are
    // waiting", at one line per reaper tick per parked run.
    console.log(
      `[llm-dispatch-gate] parked ${assemblyRun.id} at node "${node.id}" — agent dispatch is blocked`,
    );

    return;
  }
  const task = taskFromAssemblyRun(assemblyRun);
  // Resolved BEFORE the row, because the row RECORDS it: the prompt and round
  // content a pod runs on otherwise exist only on an Agent CR that is pruned
  // after the run, and "what was this node given" then has no answer at all.
  const dispatch = await resolveNodeDispatch(
    {
      node,
      task,
      iteration: transition.iteration,
      priorOutcome: priorOutcomeOf(visits, transition.nodeId),
      // What just failed, whichever node it was — this is how a retried node
      // learns why it is running again instead of repeating itself.
      incomingFailure: incomingFailureOf(visits),
    },
    deps,
  );
  // Row before CR: a crash in between leaves an open row the reaper resolves by
  // reading the (deterministically named) CR; a rowless CR would be invisible.
  // The row is also what MINTS the station-run id — a converged duplicate returns
  // the id already minted, so a re-dispatch of the same visit carries the same
  // label rather than a second identity.
  //
  // A node the POOLED SERVICE will run names no CR, because none will exist. That
  // null is what the reaper reads: a missing CR for a POD node is the
  // crash-between-row-and-launch case and is relaunched, while a service node
  // relaunched as a pod would run alongside the delivery still queued for it —
  // duplicate Issues, duplicate episodes.
  const runsInService = isServiceNode(node.type);
  // A POD node's row parks `queued` for a cluster-agent's claim (FR3); human and
  // service rows keep the default `running` — they are never claimable, and the
  // claim also requires an armed dispatch, which neither ever gets.
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

  // A human station's worker is outside the pod system — a person in the wizard,
  // or a reviewer on the PR page. The row is what parks the walk and lets the graph
  // show whose move it is; nothing is dispatched, and the outcome arrives later as
  // a resume.
  if (isHumanStation(node.type)) {
    return;
  }

  // A station that runs in the pooled service is PUBLISHED, not launched: the row
  // above already exists, so the service has something to report against, and the
  // dedupe key is that row — a redelivered event cannot run the node twice.
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

  // Arm the queued row with the complete dispatch spec instead of pushing to the
  // single cluster-agent (FR3): a cluster-agent claims it and creates the Agent
  // CR in its own cluster. Written AFTER ensureStationRun because the spec
  // carries the minted stationRunId; only armed rows are claimable, so a crash
  // between the two leaves a row the queue-wait bound settles rather than a
  // claim with nothing to run. Iteration rides into the CR name + labels so a
  // revisited node runs a fresh pod.
  await deps.assemblyRuns.enqueueStationRunDispatch(
    nodeRowId,
    nodeLaunchSpec(dispatch, {
      node,
      task,
      iteration: transition.iteration,
      stationRunId,
      priorOutcome: priorOutcomeOf(visits, transition.nodeId),
      incomingFailure: incomingFailureOf(visits),
    }),
  );
}

/** Close the row, reclaim the token, and settle the detect fan-out's job_run. */
export async function finishLine(
  assemblyRun: AssemblyRunRecord,
  outcome: string,
  reason: string | undefined,
  deps: AdvanceDeps,
): Promise<void> {
  const jobRunId = assemblyRun.args.job_run_id;

  // Settle the detect fan-out's job_run BEFORE closing the row: if the row close
  // commits but this step then throws, the event retry's advanceLine early-returns
  // on the now-terminal row and the job_run would orphan open forever. Classify by
  // "complete only on completed/lease_held; fail everything else" so a future fail
  // outcome added to Transition can never record a failed run as complete.
  if (typeof jobRunId === "string" && jobRunId.length > 0) {
    if (outcome === "completed") {
      await deps.jobRuns.complete(
        jobRunId,
        `station run: ${assemblyRun.blueprintName}:${assemblyRun.repo} ${outcome}`,
      );
    } else if (outcome === "lease_held") {
      await deps.jobRuns.complete(jobRunId, `skipped: ${reason}`);
    } else {
      await deps.jobRuns.fail(jobRunId, reason ?? outcome);
    }
  }

  const closedNow = await deps.assemblyRuns.finish(
    assemblyRun.id,
    outcome,
    reason,
  );

  // finish is first-writer-wins — a losing racer (node event vs reaper re-advance)
  // closes 0 rows yet still reaches here, so cleanupToken MUST be idempotent
  // (cleanupPerTaskToken swallows 404s); the double-reclaim is a harmless no-op.
  await deps.cleanupToken(assemblyRun.taskId ?? assemblyRun.id);

  // Telemetry, so it never decides whether the run closes: a run whose episode
  // could not be written is still a finished run, and swallowing here is the same
  // bias maybeStampPr takes for the same reason.
  //
  // Winner-gated like every other side effect below. Run before the CAS it fired
  // for the LOSER too, so an event-vs-reaper race wrote one run's story twice —
  // deduplicated only when both renderings came out byte-identical, which they do
  // not when the two doors derive different outcomes.
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

  // The winning finisher also settles the backing task. Without this a line-backed
  // task stays `running` with a NULL failure_reason forever — the watcher's
  // post-completion path returns early for node CRs, so nobody else ever closes it.
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

  // Only the winning finisher tells the user — losers would duplicate the Slack
  // message and PR comment. Never let a notification failure poison the close.
  if (closedNow && isFailureOutcome(outcome) && deps.notifyFailure) {
    try {
      await deps.notifyFailure(assemblyRun, outcome, reason);
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

  // The CAS answer, not a discarded side effect: `false` means another delivery
  // already closed this node, and `undefined` target means it was closed before
  // this one even read. Either way the follow-up ALREADY fired, and firing it
  // again re-routes a comment-triage result that was routed a moment ago.
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

  // The once-only effects are gated on having won the CAS; the walk is NOT.
  // advanceLine re-derives its next step from the node rows, so running it again
  // is a no-op when the first delivery got there — and the recovery when that
  // delivery closed the node and then died before advancing.
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

/**
 * Run the node-finished reaction, and never let it stop the walk.
 *
 * A follow-up that cannot be started is worth a log line; a run parked forever
 * because the thing that reads its result threw is not. Same bias as
 * `maybeStampPr`, for the same reason.
 */
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

    // A node the graph does not know is a wiring bug — a run whose snapshot
    // graph disagrees with the id the walk just finished. Silently skipping the
    // reaction would drop a triage routing with nothing to show for it, which is
    // the exact failure this hook was just re-keyed to prevent.
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
/** Flip the run's PR out of draft when the step it just finished hands off to
 *  the human wait. Never fails the run: a PR left in draft is a run parked for
 *  a human, which is recoverable; failing here would discard finished work. */
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

    await deps.markPrReady(assemblyRun);
  } catch (err) {
    console.error("[spec-pr] mark-ready failed:", (err as Error).message);
  }
}

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
