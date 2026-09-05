/** Feature-planning reaper (every minute): recovers an orphaned planning round (container died before the iteration row closed, detected via {@link StationBackend.isActive}) and a missed status transition (a `ready` result whose non-atomic write left the feature stuck in `planning`). Pure decision in {@link decidePlanningRecovery}; this file is the I/O. */

import { query } from "../../kernel/db.js";
import { pipeline } from "../../kernel/queues.js";
import { projectFor } from "../../kernel/project-boot.js";
import { stationBackendNow } from "../../kernel/project-boot.js";
import {
  decidePlanningRecovery,
  latestReadyGap,
  type FeatureWithIterations,
} from "@re-cinq/lore-shared/project/features/features-port.js";
import { applyGapResult } from "@re-cinq/lore-shared/feature-planning/apply-gap-result.js";
import { gapResultFromTurns } from "@re-cinq/lore-shared/feature-planning/recover-gap-result.js";
import { decideArtifactRecovery } from "./planning-artifact-recovery.js";
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
    open: runOpen,
  });
}

async function applyPlanningRecoveryAction(
  project: Project,
  feature: FeatureWithIterations,
  ctx: RoundContext,
  { row, now }: { row: Candidate; now: number },
): Promise<Partial<ReaperTally>> {
  const { latest, latestRun, runOpen } = ctx;
  const isActive = await roundStillActive(
    latest,
    latestRun !== undefined,
    runOpen,
  );
  const action = decidePlanningRecovery({
    iterations: feature.iterations,
    featureStatus: feature.status,
    isActive,
    nowMs: now,
    runOpen,
  });

  if (action.kind === "orphan") {
    await recoverOrphan(project, feature, action.iteration);
    console.log(
      `[feature-planning-reaper] recovered orphaned round ${action.iteration} for ${row.repo}/${row.id}`,
    );

    return { orphaned: 1 };
  }

  if (action.kind !== "transition") {
    return {};
  }
  const gap = latest!.gap_result!;

  await project.features.transitionStatus(
    feature.id,
    decideFeatureStatus(gap),
    {
      draft_spec_md: gap.draft_spec_markdown,
    },
  );
  console.log(
    `[feature-planning-reaper] applied missed transition for ${row.repo}/${row.id}`,
  );

  return { transitioned: 1 };
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
  const recoveredFromTranscript = await tryRecoverFromTranscript(
    project,
    feature,
    ctx,
  );

  if (recoveredFromTranscript) {
    console.log(
      `[feature-planning-reaper] recovered round ${ctx.latest!.iteration} for ${row.repo}/${row.id} from the run transcript`,
    );

    return { recovered: 1 };
  }

  return applyPlanningRecoveryAction(project, feature, ctx, { row, now });
}

function mergeTally(tally: ReaperTally, delta: Partial<ReaperTally>): void {
  tally.orphaned += delta.orphaned ?? 0;
  tally.transitioned += delta.transitioned ?? 0;
  tally.recovered += delta.recovered ?? 0;
}

export async function featurePlanningReaperJob(): Promise<string> {
  // The failed arm is bounded to a day: only a recent failed round can still be an artifact-recovery candidate; lostArtifactRound rejects any older one the loop inspects.
  const rows = await query<Candidate>(
    `SELECT DISTINCT f.id, f.repo
       FROM lore.features f
       JOIN lore.feature_iterations i ON i.feature_id = f.id
      WHERE i.status = 'running'
         OR (i.status = 'ready' AND f.status = 'planning')
         OR (i.status = 'failed' AND i.gap_result IS NULL
             AND i.updated_at > now() - interval '1 day')`,
  );

  if (rows.length === 0) {
    return "No stuck planning features";
  }

  const now = Date.now();
  const tally: ReaperTally = { orphaned: 0, transitioned: 0, recovered: 0 };

  for (const row of rows) {
    try {
      const result = await processFeatureCandidate(row, now);

      mergeTally(tally, result);
    } catch (err) {
      console.error(
        `[feature-planning-reaper] ${row.repo}/${row.id}: ${(err as Error).message}`,
      );
    }
  }

  return `Recovered ${tally.orphaned} orphaned round(s), fixed ${tally.transitioned} missed transition(s), replayed ${tally.recovered} lost artifact(s) across ${rows.length} feature(s)`;
}

/** Run decideArtifactRecovery for a lost round and, when it says recover, re-apply the artifact from the run transcript. */
async function recoverLostRound(
  project: Project,
  featureId: string,
  lostRound: NonNullable<ReturnType<typeof lostArtifactRound>>,
  run: { graph: Parameters<typeof decideArtifactRecovery>[1]; open: boolean },
): Promise<boolean> {
  const stationRuns = await pipeline().assemblyRuns.listStationRuns(
    lostRound.runId,
  );
  const decision = decideArtifactRecovery(stationRuns, run.graph, run.open);

  if (decision.kind !== "recover") {
    return false;
  }

  return recoverArtifact(project, featureId, lostRound.round, {
    runId: lostRound.runId,
    agentCrName: decision.agentCrName,
  });
}

/** isActive probes the agent-cr backend this repo's round ran on — the legacy path for rounds that predate assembly-run execution. */
async function roundStillActive(
  latest: FeatureWithIterations["iterations"][number] | undefined,
  latestRunExists: boolean,
  runOpen: boolean,
): Promise<boolean> {
  if (latest?.status !== "running" || !latest.task_id) {
    return true;
  }

  if (latestRunExists) {
    return runOpen;
  }

  return (await stationBackendNow()).isActive(latest.task_id);
}

/** The round + run pair eligible for artifact recovery (#1298): a recent round with no result whose task ran on an assembly run, while the feature is still mid-planning; null otherwise. */
function lostArtifactRound(
  latest: FeatureWithIterations["iterations"][number] | undefined,
  latestRun: { id: string } | undefined,
  featureStatus: string,
): { round: { iteration: number }; runId: string } | null {
  if (!latest || !latestRun || latest.gap_result) {
    return null;
  }

  if (!["failed", "running"].includes(latest.status)) {
    return null;
  }

  return isPlanningPhase(featureStatus)
    ? { round: latest, runId: latestRun.id }
    : null;
}

/** How many transcript turns one recovery scan will page through before giving up — a runaway bound, not a tuning knob. */
const RECOVERY_TURN_PAGE = 200;
const RECOVERY_TURN_PAGES_MAX = 25;

/** Re-apply a lost round result from the run transcript (#1298): the terminal `Write` of `result.json` holds the full GapResult; returns false when none was produced. `agentCrName` scopes the scan to THIS round's pod (#1302) — unscoped (null) would replay a previous round's result on a multi-round run. */
async function recoverArtifact(
  project: Project,
  featureId: string,
  latest: { iteration: number },
  { runId, agentCrName }: { runId: string; agentCrName: string | null },
): Promise<boolean> {
  const envelopes: unknown[] = [];
  let cursor = "0";

  for (let page = 0; page < RECOVERY_TURN_PAGES_MAX; page++) {
    const turns = await pipeline().agentRunTurns.listByLine(
      runId,
      cursor,
      RECOVERY_TURN_PAGE,
    );

    if (turns.length === 0) {
      break;
    }
    envelopes.push(
      ...turns
        .filter(
          (turn) => agentCrName === null || turn.agentCrName === agentCrName,
        )
        .map((turn) => turn.envelope),
    );
    cursor = turns[turns.length - 1].id;
  }

  const payload = gapResultFromTurns(envelopes, "result.json");

  if (payload === null) {
    return false;
  }

  const applied = await applyGapResult(
    project.features,
    featureId,
    latest.iteration,
    payload,
  );

  return applied.outcome === "ready";
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

  // The orphan is `running`, so latestReadyGap naturally skips it and returns the last result-bearing round to restore, else falls back to `draft`.
  const lastGood = latestReadyGap(feature.iterations);

  if (lastGood) {
    await project.features.transitionStatus(
      feature.id,
      decideFeatureStatus(lastGood),
      {
        draft_spec_md: lastGood.draft_spec_markdown,
      },
    );

    return;
  }
  await project.features.transitionStatus(feature.id, "draft");
}
