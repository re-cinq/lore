/** Feature-planning reaper (every minute): recovers an orphaned planning round (container died before the iteration row closed, detected via {@link StationBackend.isActive}) and a missed status transition (a `ready` result whose non-atomic write left the feature stuck in `planning`). Pure decision in {@link decidePlanningRecovery}; this file is the I/O. */

import { query } from "../../outbound/db.js";
import { pipeline } from "../../outbound/queues.js";
import { projectFor } from "../../outbound/project-boot.js";
import { stationBackendNow } from "../../outbound/project-boot.js";
import {
  decidePlanningRecovery,
  latestReadyGap,
  type FeatureWithIterations,
} from "@re-cinq/lore-shared/project/features/features-port.js";
import {
  lostArtifactRound,
  recoverLostRound,
} from "./planning-artifact-replay.js";
import {
  decideFeatureStatus,
  isPlanningPhase,
} from "@re-cinq/lore-shared/feature-planning/gap-result.js";

type Project = Awaited<ReturnType<typeof projectFor>>;

interface Candidate {
  id: string;
  repo: string;
}

interface ReaperTally {
  orphaned: number;
  transitioned: number;
  recovered: number;
}

/** The assembly run, not the CR listing, is the liveness authority — a transient empty k8s list killed a live round on 2026-08-18 (#1297); direct probe survives only for legacy rounds with no run row. */
async function loadRoundContext(feature: FeatureWithIterations) {
  const latest = feature.iterations.at(-1);
  const latestRun = latest?.task_id
    ? (await pipeline().assemblyRuns.listForTask(latest.task_id))[0]
    : undefined;
  const runOpen =
    latestRun !== undefined && ["queued", "running"].includes(latestRun.status);

  return { latest, latestRun, runOpen };
}

type RoundContext = Awaited<ReturnType<typeof loadRoundContext>>;

/** A round whose agent succeeded but whose result delivery was lost (#1298) heals from the transcript, never orphaned; decideArtifactRecovery's call (#1302) replaced the blanket "open run" exemption that hid this parked-on-author shape. */
async function tryRecoverFromTranscript(
  project: Project,
  feature: FeatureWithIterations,
  { latest, latestRun, runOpen }: RoundContext,
): Promise<boolean> {
  const lostRound = lostArtifactRound(latest, latestRun, feature.status);

  if (lostRound === null) {
    return false;
  }

  return recoverLostRound(project, feature.id, lostRound, {
    graph: latestRun?.graph ?? null,
    runOpen,
  });
}

/** What this stalled round needs. "Still active" is asked of the RUN, not the clock: a round whose run is open is working, however long it has been, and only a round nobody is running can be recovered from underneath. */
async function decideRecovery(
  feature: FeatureWithIterations,
  ctx: RoundContext,
  now: number,
): Promise<ReturnType<typeof decidePlanningRecovery>> {
  const { runOpen } = ctx;

  return decidePlanningRecovery({
    iterations: feature.iterations,
    featureStatus: feature.status,
    isActive: await roundStillActive(ctx),
    nowMs: now,
    runOpen,
  });
}

/** Applies a transition the round produced but nobody recorded — the gap result is already in the row, so this is replaying a write that was lost, not deciding anything new. */
async function applyMissedTransition(
  project: Project,
  feature: FeatureWithIterations,
  gap: NonNullable<RoundContext["latest"]>["gap_result"],
  row: Candidate,
): Promise<void> {
  await project.features.transitionStatus(
    feature.id,
    decideFeatureStatus(gap!),
    {
      draft_spec_md: gap!.draft_spec_markdown,
    },
  );
  console.log(
    `[feature-planning-reaper] applied missed transition for ${row.repo}/${row.id}`,
  );
}

/** Fails the orphaned round and restores the feature, then says so — the log line is what makes a silent recovery auditable. */
async function applyOrphanRecovery(
  project: Project,
  feature: FeatureWithIterations,
  row: Candidate,
  iteration: number,
): Promise<void> {
  await recoverOrphan(project, feature, iteration);
  console.log(
    `[feature-planning-reaper] recovered orphaned round ${iteration} for ${row.repo}/${row.id}`,
  );
}

async function applyPlanningRecoveryAction(
  project: Project,
  feature: FeatureWithIterations,
  ctx: RoundContext,
  { row, now }: { row: Candidate; now: number },
): Promise<Partial<ReaperTally>> {
  const action = await decideRecovery(feature, ctx, now);

  if (action.kind === "orphan") {
    await applyOrphanRecovery(project, feature, row, action.iteration);

    return { orphaned: 1 };
  }

  if (action.kind !== "transition") {
    return {};
  }

  await applyMissedTransition(project, feature, ctx.latest!.gap_result!, row);

  return { transitioned: 1 };
}

/** The tally delta for a round healed from the run transcript, or null when there was nothing to heal. */
async function transcriptRecoveryTally(
  project: Project,
  feature: FeatureWithIterations,
  ctx: RoundContext,
  row: Candidate,
): Promise<Partial<ReaperTally> | null> {
  if (!(await tryRecoverFromTranscript(project, feature, ctx))) {
    return null;
  }
  console.log(
    `[feature-planning-reaper] recovered round ${ctx.latest!.iteration} for ${row.repo}/${row.id} from the run transcript`,
  );

  return { recovered: 1 };
}

async function processFeatureCandidate(
  row: Candidate,
  now: number,
): Promise<Partial<ReaperTally>> {
  const project = await projectFor(row.repo);
  const feature = await project.features.get(row.id);

  if (!feature) {
    return {};
  }

  const ctx = await loadRoundContext(feature);
  const healed = await transcriptRecoveryTally(project, feature, ctx, row);

  if (healed) {
    return healed;
  }

  return applyPlanningRecoveryAction(project, feature, ctx, { row, now });
}

function mergeTally(tally: ReaperTally, delta: Partial<ReaperTally>): void {
  tally.orphaned += delta.orphaned ?? 0;
  tally.transitioned += delta.transitioned ?? 0;
  tally.recovered += delta.recovered ?? 0;
}

/** The failed arm is bounded to a day: only a recent failed round can still be an artifact-recovery candidate; lostArtifactRound rejects any older one the loop inspects. */
async function loadStuckFeatures(): Promise<Candidate[]> {
  return query<Candidate>(
    `SELECT DISTINCT f.id, f.repo
       FROM lore.features f
       JOIN lore.feature_iterations i ON i.feature_id = f.id
      WHERE i.status = 'running'
         OR (i.status = 'ready' AND f.status = 'planning')
         OR (i.status = 'failed' AND i.gap_result IS NULL
             AND i.updated_at > now() - interval '1 day')`,
  );
}

/** One candidate's contribution to the tally; a failure on one feature must never stop the sweep. */
async function tallyFeatureCandidate(
  row: Candidate,
  now: number,
  tally: ReaperTally,
): Promise<void> {
  try {
    mergeTally(tally, await processFeatureCandidate(row, now));
  } catch (err) {
    console.error(
      `[feature-planning-reaper] ${row.repo}/${row.id}: ${(err as Error).message}`,
    );
  }
}

export async function featurePlanningReaperJob(): Promise<string> {
  const rows = await loadStuckFeatures();

  if (rows.length === 0) {
    return "No stuck planning features";
  }

  const now = Date.now();
  const tally: ReaperTally = { orphaned: 0, transitioned: 0, recovered: 0 };

  for (const row of rows) {
    await tallyFeatureCandidate(row, now, tally);
  }

  return `Recovered ${tally.orphaned} orphaned round(s), fixed ${tally.transitioned} missed transition(s), replayed ${tally.recovered} lost artifact(s) across ${rows.length} feature(s)`;
}

/** isActive probes the agent-cr backend this repo's round ran on — the legacy path for rounds that predate assembly-run execution. */
async function roundStillActive({
  latest,
  latestRun,
  runOpen,
}: RoundContext): Promise<boolean> {
  if (latest?.status !== "running" || !latest.task_id) {
    return true;
  }

  if (latestRun !== undefined) {
    return runOpen;
  }

  return (await stationBackendNow()).isActive(latest.task_id);
}

/** Restores the feature to its last result-bearing round, or `draft` when the orphan was the only round it ever had. */
async function restoreLastGoodRound(
  project: Project,
  feature: FeatureWithIterations,
): Promise<void> {
  // The orphan is `running`, so latestReadyGap naturally skips it and returns the last result-bearing round to restore, else falls back to `draft`.
  const lastGood = latestReadyGap(feature.iterations);

  if (!lastGood) {
    await project.features.transitionStatus(feature.id, "draft");

    return;
  }
  await project.features.transitionStatus(
    feature.id,
    decideFeatureStatus(lastGood),
    { draft_spec_md: lastGood.draft_spec_markdown },
  );
}

/** Mark the orphaned round failed, then restore the feature to its last result-bearing round (or `draft` if none). Skips a feature already past planning so a stale orphan can't drag it backwards. */
async function recoverOrphan(
  project: Project,
  feature: FeatureWithIterations,
  iteration: number,
): Promise<void> {
  await project.features.setIterationResult(
    feature.id,
    iteration,
    null,
    "failed",
  );

  if (!isPlanningPhase(feature.status)) {
    return;
  }
  await restoreLastGoodRound(project, feature);
}
