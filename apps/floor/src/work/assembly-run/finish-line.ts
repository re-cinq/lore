/** Closing a run: settling its job_run, telemetry, and the once-per-line notifications. */

import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { lineWritesOwnEpisode } from "./run-episode.js";
import { isFailureOutcome } from "./notify-failure.js";
import type { AdvanceDeps } from "./advance-deps.js";

/** Complete only on completed/lease_held; fail everything else, so a future fail outcome added to Transition can never record a failed run as complete. */
async function settleJobRun(
  jobRunId: string,
  assemblyRun: AssemblyRunRecord,
  { outcome, reason }: { outcome: string; reason: string | undefined },
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

/** Telemetry only, swallowed on failure like maybeStampPr — an unwritten episode is still a finished run. */
async function recordRunEpisodeIfOwned(
  assemblyRun: AssemblyRunRecord,
  outcome: string,
  reason: string | undefined,
  deps: AdvanceDeps,
): Promise<void> {
  if (!deps.recordRunEpisode || lineWritesOwnEpisode(assemblyRun.graph)) {
    return;
  }

  try {
    await deps.recordRunEpisode(assemblyRun, outcome, reason);
  } catch (err) {
    console.warn(
      `[assembly-run] episode for ${assemblyRun.id} not recorded:`,
      (err as Error).message,
    );
  }
}

async function callOnRunClosed(
  assemblyRun: AssemblyRunRecord,
  outcome: string,
  reason: string | undefined,
  deps: AdvanceDeps,
): Promise<void> {
  if (!deps.onRunClosed) {
    return;
  }

  try {
    await deps.onRunClosed(assemblyRun, outcome, reason);
  } catch (err) {
    console.error("[on-run-closed] hook threw:", (err as Error).message);
  }
}

/** Only the winning finisher tells the user — losers would duplicate the Slack message and PR comment. */
async function notifyFailureIfApplicable(
  assemblyRun: AssemblyRunRecord,
  outcome: string,
  reason: string | undefined,
  deps: AdvanceDeps,
): Promise<void> {
  if (!isFailureOutcome(outcome) || !deps.notifyFailure) {
    return;
  }

  try {
    await deps.notifyFailure(assemblyRun, outcome, reason);
  } catch (err) {
    console.error("[notify-failure] notifier threw:", (err as Error).message);
  }
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
    await settleJobRun(jobRunId, assemblyRun, { outcome, reason }, deps);
  }

  const closedNow = await deps.assemblyRuns.finish(
    assemblyRun.id,
    outcome,
    reason,
  );

  // finish is first-writer-wins — a losing racer still reaches here, so cleanupToken MUST be idempotent (cleanupPerTaskToken swallows 404s).
  await deps.cleanupToken(assemblyRun.taskId ?? assemblyRun.id);

  if (!closedNow) {
    return;
  }

  // Winner-gated below — an event-vs-reaper race can otherwise write one run's episode twice.
  await recordRunEpisodeIfOwned(assemblyRun, outcome, reason, deps);

  // Without this a line-backed task stays `running` forever — the watcher's post-completion path returns early for node CRs.
  if (deps.settleTask) {
    await deps.settleTask(assemblyRun, outcome, reason);
  }

  await callOnRunClosed(assemblyRun, outcome, reason, deps);
  await notifyFailureIfApplicable(assemblyRun, outcome, reason, deps);
}
