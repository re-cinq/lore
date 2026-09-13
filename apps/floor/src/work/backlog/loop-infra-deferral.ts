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
}

/** Failure classes that say nothing about the ticket: no pod ever ran, or the pod died under it. Re-running the previous node cannot summon a cluster (#1648), but the NEXT tick can. */
const INFRA_CLASSES = new Set(["unclaimed", "infra"]);

/** A run whose last recorded visit failed on the cluster rather than on the work. */
export function isInfraFailure(visits: readonly StationVisit[]): boolean {
  const last = visits.findLast((visit) => visit.outcome !== null);

  return (
    last?.outcome === "failed" && INFRA_CLASSES.has(last.failureClass ?? "")
  );
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

  if (!isInfraFailure(visits) || !run.branch) {
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
  const visits = await Promise.all(
    prior.map((run) => assemblyRuns.listStationRuns(run.id)),
  );

  return visits.filter(isInfraFailure).length;
}
