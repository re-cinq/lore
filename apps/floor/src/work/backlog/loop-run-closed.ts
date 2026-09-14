import type { EventProxy } from "@re-cinq/lore-shared/project/events/event-proxy.js";
import { LORE_BLOCKED_LABEL } from "@re-cinq/lore-shared";
import type { RunGraph } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import { dodResolvedReason } from "@re-cinq/lore-assembly-lines";
import {
  commentDeferral,
  countInfraFailures,
  erroredVerdict,
  infraDeferralsFromEnv,
  type ParkVerdict,
} from "./loop-infra-deferral.js";

/** The closed run's slice the hook reads — structurally satisfied by AssemblyRunRecord. */
export interface ClosedLoopRun {
  id: string;
  repo: string;
  blueprintName: string;
  taskId?: string | null;
  /** The ticket's branch (FR11) — what every attempt on one ticket shares, so an infrastructure deferral can be counted across runs. */
  branch?: string | null;
  args: Record<string, unknown>;
  graph: RunGraph | null;
}

/** One recorded node visit, as the hook reads it: `failureDetail` is where a node's own words about why it stopped are persisted (the definition-of-done verdict rides it, FR8). */
export interface StationVisit {
  nodeId: string;
  iteration: number;
  outcome: string | null;
  failureDetail?: string | null;
  /** The shared FailureCategory of a failed visit — `unclaimed`/`infra` mean nothing about the ticket, only about the cluster. */
  failureClass?: string | null;
}

export interface LoopRunClosedDeps {
  getTaskIssueNumber(taskId: string): Promise<number | null>;
  listStationRuns(runId: string): Promise<StationVisit[]>;
  addLabel(repo: string, issueNumber: number, label: string): Promise<void>;
  comment(repo: string, issueNumber: number, body: string): Promise<void>;
  closeIssue(repo: string, issueNumber: number): Promise<void>;
  closePr(repo: string, prNumber: number): Promise<void>;
  /** Re-arm: emit `cron.implementation_loop.tick` scoped to the repo, so the next ticket starts in seconds, not at the next 5-minute safety tick. */
  emitTick(repo: string): Promise<void>;
  /** How many EARLIER runs on this branch since `since` ended on an infrastructure failure — the deferral count a new failure adds one to. `excludeRunId` is the run that just closed: it is already `failed` in the table, so a count that kept it would report every first failure as the second. */
  priorInfraFailures(
    repo: string,
    branch: string,
    since: Date,
    excludeRunId: string,
  ): Promise<number>;
  /** Infrastructure failures a ticket may absorb within a day before it parks; `LORE_LOOP_INFRA_DEFERRALS`, default 3. */
  maxInfraDeferrals: number;
}

/** Terminal outcomes that are NOT failures — everything else blocks the ticket. */
const CLEAN_OUTCOMES = new Set(["completed", "lease_held"]);

/** The loop's terminal hook (FR2 re-arm + FR8 blocked tickets): a blocked/errored ticket gets `lore:blocked` (ineligible under FR1) plus a comment naming the failure, PR left open; a ticket the definition-of-done step found already resolved is closed with the reason, PR included; the re-arm always happens even when the issue write fails, so one bad ticket never freezes the backlog. */
export async function handleLoopRunClosed(
  run: ClosedLoopRun,
  outcome: string,
  reason: string | undefined,
  deps: LoopRunClosedDeps,
): Promise<void> {
  if (run.blueprintName !== "implementation-loop") {
    return;
  }

  try {
    await settleIssue(run, outcome, reason, deps);
  } catch (err) {
    console.error(
      `[implementation-loop] issue settling for ${run.id} failed: ${(err as Error).message}`,
    );
  }
  await deps.emitTick(run.repo);
}

async function settleIssue(
  run: ClosedLoopRun,
  outcome: string,
  reason: string | undefined,
  deps: LoopRunClosedDeps,
): Promise<void> {
  const verdict = await parkVerdict(run, outcome, reason, deps);

  if (!verdict) {
    return;
  }

  if (verdict.deferral) {
    await commentDeferral(run, verdict.deferral, deps);

    return;
  }

  if (verdict.resolved) {
    await closeResolvedIssue(run, verdict.resolved, deps);

    return;
  }
  await markIssueBlocked(run, verdict, deps);
}

async function parkVerdict(
  run: ClosedLoopRun,
  outcome: string,
  reason: string | undefined,
  deps: LoopRunClosedDeps,
): Promise<ParkVerdict | null> {
  if (!CLEAN_OUTCOMES.has(outcome)) {
    return await erroredVerdict(run, outcome, reason, deps);
  }
  const routed = await parkedVisit(run, deps);

  return routed
    ? {
        why: describeParked(run, routed),
        askForRewrite: declined(routed),
        resolved: dodResolvedReason(routed.failureDetail) ?? undefined,
      }
    : null;
}

/** How the parking comment names what happened, per node. */
function describeParked(run: ClosedLoopRun, routed: StationVisit): string {
  return nodeIdsOfType(run, "pr_review").has(routed.nodeId)
    ? describeReviewNotReady(routed.outcome ?? "", argReason(run))
    : describeDeclined(routed);
}

/** The review node's two endings keep their established wording (FR8). */
function describeReviewNotReady(
  outcome: string,
  reason: string | undefined,
): string {
  const detail = reason ? ` (${reason})` : "";
  const why =
    outcome === "failed"
      ? "review threads stayed unresolved after the address round-trip"
      : "its build stayed red after the repair attempts were spent";

  return `the pull request was not ready${detail}: ${why}`;
}

/** A node that ended anywhere but the review node: the node's own words first when it left any. */
function describeDeclined(routed: StationVisit): string {
  const detail = routed.failureDetail ? `: ${routed.failureDetail}` : "";

  if (routed.nodeId === "dod" && routed.outcome === "changes_requested") {
    return `the definition-of-done step could not express this ticket as acceptance tests${detail}`;
  }

  return routed.outcome === "failed"
    ? `the \`${routed.nodeId}\` step reported it was stuck${detail}`
    : `the \`${routed.nodeId}\` step ended \`${routed.outcome}\`${detail}`;
}

function argReason(run: ClosedLoopRun): string | undefined {
  return typeof run.args.reason === "string" ? run.args.reason : undefined;
}

// Success into the retrospective is the ticket reaching review; anything else is a park. Blocking on every non-success (not only `failed`) is what stops a re-armed run's `iteration_max` from resetting and cycling unbounded across runs.
async function parkedVisit(
  run: ClosedLoopRun,
  deps: LoopRunClosedDeps,
): Promise<StationVisit | null> {
  const routed = routedIntoRetrospective(
    run,
    await deps.listStationRuns(run.id),
  );

  return routed && routed.outcome !== "success" ? routed : null;
}

/** The visit that routed into the run's last retrospective — the row written just before it. A blocked ticket is whichever node ended there on anything but success: the review node's two verdicts, the definition-of-done park, a stuck round, a repair that gave up. Null when the walk never reached a retrospective (an errored run is judged by its outcome instead). */
function routedIntoRetrospective(
  run: ClosedLoopRun,
  visits: readonly StationVisit[],
): StationVisit | null {
  const retrospectives = nodeIdsOfType(run, "retrospective");
  const ids = visits.map((visit) => visit.nodeId);
  const last = ids.lastIndexOf(
    ids.filter((id) => retrospectives.has(id)).at(-1) ?? "",
  );

  return last > 0 ? visits[last - 1] : null;
}

/** Node ids of a given type in the run's graph, falling back to the conventional id when the run carries no graph. */
function nodeIdsOfType(run: ClosedLoopRun, type: string): Set<string> {
  const graph = run.graph;

  if (!graph) {
    return new Set([type]);
  }
  const nodesOfType = graph.nodes.filter((n) => n.type === type);

  return new Set(nodesOfType.map((n) => n.id));
}

function declined(routed: StationVisit): boolean {
  return routed.nodeId === "dod" && routed.outcome === "changes_requested";
}

async function markIssueBlocked(
  run: ClosedLoopRun,
  verdict: ParkVerdict,
  deps: LoopRunClosedDeps,
): Promise<void> {
  const issueNumber = await issueNumberOf(run, deps);

  if (!issueNumber) {
    return;
  }

  await deps.addLabel(run.repo, issueNumber, LORE_BLOCKED_LABEL);
  await deps.comment(run.repo, issueNumber, blockedComment(run, verdict));
}

// Nothing to implement: the ticket closes with the reason instead of parking for a human, and the draft PR — an empty branch — goes with it (FR8). Run e0b9e349 parked #1948 as failed fourteen minutes after #2064 had merged its fix.
async function closeResolvedIssue(
  run: ClosedLoopRun,
  resolved: string,
  deps: LoopRunClosedDeps,
): Promise<void> {
  const issueNumber = await issueNumberOf(run, deps);

  if (!issueNumber) {
    return;
  }

  await deps.comment(run.repo, issueNumber, resolvedComment(run, resolved));
  await deps.closeIssue(run.repo, issueNumber);

  if (typeof run.args.pr_number === "number") {
    await deps.closePr(run.repo, run.args.pr_number);
  }
}

async function issueNumberOf(
  run: ClosedLoopRun,
  deps: LoopRunClosedDeps,
): Promise<number | null> {
  const issueNumber = run.taskId
    ? await deps.getTaskIssueNumber(run.taskId)
    : null;

  if (!issueNumber) {
    console.warn(
      `[implementation-loop] run ${run.id} ended with a verdict but no issue to mark`,
    );
  }

  return issueNumber;
}

function resolvedComment(run: ClosedLoopRun, resolved: string): string {
  const prLine =
    typeof run.args.pr_url === "string"
      ? `\n\nIts pull request is closed unmerged, since the branch carries no change: ${run.args.pr_url}`
      : "";

  return (
    `Lore's implementation loop is closing this ticket as already resolved: ${resolved}.` +
    `${prLine}\n\nReopen it if the claim still holds. Run: \`${run.id}\``
  );
}

/** What a loop-ready ticket needs, said once, only when the definition-of-done step is the one that declined. */
const REWRITE_ASK =
  "\n\nTo re-queue it for the loop, rewrite the ticket around a claim that can be stated as a test that fails today — what should be observably true afterwards that is not true now. A decision, a diagnosis, or an operator action is not something a round can write a red test for.";

function blockedComment(run: ClosedLoopRun, verdict: ParkVerdict): string {
  const prLine =
    typeof run.args.pr_url === "string"
      ? `\n\nThe pull request stays open for a human: ${run.args.pr_url}`
      : "";
  const ask = verdict.askForRewrite ? REWRITE_ASK : "";

  return (
    `Lore's implementation loop is parking this ticket: ${verdict.why}.` +
    `${prLine}${ask}\n\nRemove the \`${LORE_BLOCKED_LABEL}\` label to re-queue it. Run: \`${run.id}\``
  );
}

/** Production hook for finishLine's onRunClosed seam. */
export async function loopRunClosed(
  run: ClosedLoopRun,
  outcome: string,
  reason: string | undefined,
): Promise<void> {
  const [queues, { projectFor }] = await Promise.all([
    import("../../outbound/queues.js"),
    import("../../outbound/project-boot.js"),
  ]);

  await handleLoopRunClosed(
    run,
    outcome,
    reason,
    productionDeps(queues, projectFor),
  );
}

type LoopQueues = typeof import("../../outbound/queues.js");
type ProjectForFn =
  (typeof import("../../outbound/project-boot.js"))["projectFor"];

function productionDeps(
  queues: LoopQueues,
  projectFor: ProjectForFn,
): LoopRunClosedDeps {
  const { pipeline, taskStore, eventProxy } = queues;

  return {
    getTaskIssueNumber: (taskId) => taskIssueNumber(taskStore, taskId),
    listStationRuns: (runId) => pipeline().assemblyRuns.listStationRuns(runId),
    ...deferralDeps(pipeline),
    addLabel: async (repo, issueNumber, label) =>
      (await projectFor(repo)).issues.addLabel(issueNumber, label),
    comment: async (repo, issueNumber, body) =>
      (await projectFor(repo)).issues.comment(issueNumber, body),
    closeIssue: async (repo, issueNumber) =>
      (await projectFor(repo)).issues.close(issueNumber, "completed"),
    closePr: async (repo, prNumber) =>
      (await projectFor(repo)).pulls.close(prNumber),
    emitTick: (repo) => queueLoopTick(repo, eventProxy),
  };
}

/** QUEUED rather than inserted: `onRunClosed` swallows what this throws, so a router blip used to lose the tick until the cron emitter next came round. The proxy retries it instead. */
function queueLoopTick(
  repo: string,
  eventProxy: () => EventProxy,
): Promise<void> {
  return eventProxy().emit({
    kind: "event",
    event: {
      eventName: "cron.implementation_loop.tick",
      source: "internal",
      params: { repo },
    },
  });
}

async function taskIssueNumber(
  taskStore: LoopQueues["taskStore"],
  taskId: string,
): Promise<number | null> {
  const task = await taskStore().getById(taskId);
  const n = Number((task as { issue_number?: unknown } | null)?.issue_number);

  return n > 0 ? n : null;
}

/** The deferral half of the hook's dependencies: the branch's earlier infrastructure failures, and the bound. */
function deferralDeps(
  pipeline: LoopQueues["pipeline"],
): Pick<LoopRunClosedDeps, "priorInfraFailures" | "maxInfraDeferrals"> {
  return {
    priorInfraFailures: (repo, branch, since, excludeRunId) =>
      countInfraFailures(pipeline().assemblyRuns, {
        repo,
        branch,
        since,
        excludeRunId,
      }),
    maxInfraDeferrals: infraDeferralsFromEnv(process.env),
  };
}
