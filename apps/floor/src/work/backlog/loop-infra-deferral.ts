// The implementation loop's answer to a failure that was the CLUSTER's, not the ticket's (specs/implementation-loop FR8, 2026-09-13): defer the ticket to the next tick a bounded number of times before parking it.

import type { AssemblyRunsPort } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type {
  ClosedLoopRun,
  LoopRunClosedDeps,
  StationVisit,
} from "./loop-run-closed.js";

export interface Deferral {
  attempt: number;
  max: number;
  reason: string;
}

/** Why a ticket is parked, and whether the comment should ask its author for a rewrite; or, for an infrastructure failure under the bound, the deferral to announce instead. */
export interface ParkVerdict {
  why: string;
  askForRewrite: boolean;
  deferral?: Deferral;
  /** The definition-of-done step found the ticket's claim already true on the base branch: close, do not park. */
  resolved?: string;
}

/** Failure classes that say nothing about the ticket: no pod ever ran, or the pod died under it. Re-running the previous node cannot summon a cluster (#1648), but the NEXT tick can. */
const INFRA_CLASSES = new Set(["unclaimed", "infra"]);

/** A run whose failing visit failed on the cluster rather than on the work. The failing visit is the one that routed into a retrospective that succeeded (a reaped round routes its failure there, and the retrospective's own success must not hide it — run eb46675f), otherwise the last recorded one, a retrospective that itself failed included. */
export function isInfraFailure(
  run: ClosedLoopRun,
  visits: readonly StationVisit[],
): boolean {
  const judged = failingVisit(run, visits);

  return (
    judged?.outcome === "failed" && INFRA_CLASSES.has(judged.failureClass ?? "")
  );
}

function failingVisit(
  run: ClosedLoopRun,
  visits: readonly StationVisit[],
): StationVisit | undefined {
  const last = visits.findLast((visit) => visit.outcome !== null);
  const endedInRetrospective =
    last?.outcome === "success" &&
    nodeIdsOfType(run, "retrospective").has(last.nodeId);

  return endedInRetrospective
    ? (routedIntoRetrospective(run, visits) ?? undefined)
    : last;
}

/** The visit that routed into the run's last retrospective — the row written just before it. A blocked ticket is whichever node ended there on anything but success: the review node's two verdicts, the definition-of-done park, a stuck round, a repair that gave up. Null when the walk never reached a retrospective (an errored run is judged by its outcome instead). */
export function routedIntoRetrospective(
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
export function nodeIdsOfType(run: ClosedLoopRun, type: string): Set<string> {
  const graph = run.graph;

  if (!graph) {
    return new Set([type]);
  }
  const nodesOfType = graph.nodes.filter((n) => n.type === type);

  return new Set(nodesOfType.map((n) => n.id));
}

const DEFERRAL_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Default when the env var is unset or not a positive integer. */
export const DEFAULT_INFRA_DEFERRALS = 3;

export function infraDeferralsFromEnv(env: NodeJS.ProcessEnv): number {
  const parsed = Number(env.LORE_LOOP_INFRA_DEFERRALS);

  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_INFRA_DEFERRALS;
}

/** An errored run parks the ticket — unless the cluster, not the work, failed, in which case the ticket is deferred to the next tick, up to `maxInfraDeferrals` times a day. Six tickets parked in a row on 2026-09-12 (13:26–16:01) while no cluster-agent claimed anything; none of them was wrong. */
export async function erroredVerdict(
  run: ClosedLoopRun,
  outcome: string,
  reason: string | undefined,
  deps: LoopRunClosedDeps,
): Promise<ParkVerdict> {
  const why = reason
    ? `the run ended ${outcome}: ${reason}`
    : `the run ended ${outcome}`;
  const visits = await deps.listStationRuns(run.id);

  if (!isInfraFailure(run, visits) || !run.branch) {
    return { why, askForRewrite: false };
  }
  const since = new Date(Date.now() - DEFERRAL_WINDOW_MS);
  const attempt =
    (await deps.priorInfraFailures(run.repo, run.branch, since, run.id)) + 1;

  return boundedDeferral(why, attempt, deps.maxInfraDeferrals);
}

/** Under the bound the ticket is deferred; the failure that reaches it parks the ticket with the count, so an outage that outlives the bound still reaches a human. */
function boundedDeferral(
  why: string,
  attempt: number,
  max: number,
): ParkVerdict {
  if (attempt >= max) {
    return {
      why: `${why} — infrastructure failure ${attempt} of ${max} on this ticket within a day, so the loop stops deferring it`,
      askForRewrite: false,
    };
  }

  return { why, askForRewrite: false, deferral: { attempt, max, reason: why } };
}

/** A deferral leaves the ticket eligible: no label, one short comment so the issue shows why nothing landed, and the re-arm picks it again. */
export async function commentDeferral(
  run: ClosedLoopRun,
  deferral: Deferral,
  deps: LoopRunClosedDeps,
): Promise<void> {
  const issueNumber = run.taskId
    ? await deps.getTaskIssueNumber(run.taskId)
    : null;

  if (!issueNumber) {
    return;
  }

  await deps.comment(
    run.repo,
    issueNumber,
    `Lore's implementation loop is deferring this ticket, not parking it (infrastructure attempt ${deferral.attempt} of ${deferral.max}): ${deferral.reason}. Nothing about the ticket failed; it stays queued and the next tick picks it again. Run: \`${run.id}\``,
  );
}

export interface InfraFailureCountInput {
  repo: string;
  branch: string;
  since: Date;
  /** The run that just closed — already `failed` in the table, so it must not count as its own precedent. */
  excludeRunId: string;
}

/** Earlier runs on the branch whose last visit failed on the cluster; read by visits, not by run status, because a failed run is recorded as `finished`/`failed` by the walk and `failed`/`error` by the reaper. A handful of reads at most, since a ticket sees few runs a day. */
export async function countInfraFailures(
  assemblyRuns: Pick<AssemblyRunsPort, "list" | "listStationRuns">,
  input: InfraFailureCountInput,
): Promise<number> {
  const runs = await assemblyRuns.list({
    repo: input.repo,
    blueprintName: "implementation-loop",
    branch: input.branch,
    createdAfter: input.since,
  });
  const prior = runs.filter((run) => run.id !== input.excludeRunId);
  const infraFailures = await Promise.all(
    prior.map(async (run) =>
      isInfraFailure(run, await assemblyRuns.listStationRuns(run.id)),
    ),
  );

  return infraFailures.filter(Boolean).length;
}
