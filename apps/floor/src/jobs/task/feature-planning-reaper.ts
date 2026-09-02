/**
 * Feature-planning reaper.
 *
 * A planning round is a single LLM→JSON call run in a Station (a docker
 * container locally, a LoreTask CR on the cluster). Two ways it gets stuck and
 * the wizard "analyzes" forever:
 *
 *   1. Orphaned round — the container/pod died (a `npm start` restart, a crash,
 *      an OOM) before the iteration row was closed, so it sits `running` with no
 *      runtime behind it. We detect this by probing the runtime itself
 *      ({@link StationBackend.isActive}) — a `running` iteration whose container
 *      is gone is orphaned immediately, no need to wait out a timeout — with a
 *      generous age window as a fallback for a wedged-but-listed container.
 *   2. Missed transition — a round produced a `ready` result but the feature
 *      never left `planning` (a non-atomic write between setIterationResult and
 *      transitionStatus). The result exists; the status just needs re-applying.
 *
 * Runs every minute. Pure decision in {@link decidePlanningRecovery}; this file
 * is the I/O: find candidates, probe the runtime, persist the fix.
 */

import { query } from "../../kernel/db.js";
import { pipeline } from "../../kernel/queues.js";
import { projectFor, stationBackend } from "../../composition/project-boot.js";
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

export async function featurePlanningReaperJob(): Promise<string> {
  // The failed arm is bounded to a day: a genuinely failed old round stays
  // failed; only a recent one can still be an artifact-recovery candidate.
  // The arm matches features by ANY qualifying failed iteration, but the loop
  // below only ever inspects the LATEST one — an older failed round behind a
  // newer iteration is settled history, and lostArtifactRound rejects it.
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
  let orphaned = 0;
  let transitioned = 0;
  let recovered = 0;

  for (const row of rows) {
    try {
      const project = await projectFor(row.repo);
      const feature = await project.features.get(row.id);

      if (!feature) {
        continue;
      }

      const latest = feature.iterations[feature.iterations.length - 1];
      // The round runs on an assembly run now, and the run is the liveness
      // authority: the assembly-run reaper owns its timeouts and relaunches, so
      // an OPEN run means alive regardless of what a k8s CR listing says — a
      // transient empty list executed a live round on 2026-08-18 (#1297). The
      // direct probe survives only for legacy rounds with no run row.
      const latestRun = latest?.task_id
        ? (await pipeline().assemblyRuns.listForTask(latest.task_id))[0]
        : undefined;
      const runOpen =
        latestRun !== undefined &&
        ["queued", "running"].includes(latestRun.status);

      // A round whose agent already SUCCEEDED but whose result delivery was
      // lost (#1298) is healed from the transcript, never orphaned: the
      // artifact is re-applied through the same applyGapResult the pod's own
      // delivery uses. Whether that applies — and whose transcript to read —
      // is decideArtifactRecovery's call (#1302): the blanket "running on an
      // open run" exemption this replaces hid the parked-on-author shape,
      // where the work is done and the round still reads `running`.
      const lostRound = lostArtifactRound(latest, latestRun, feature.status);

      if (lostRound !== null) {
        const stationRuns = await pipeline().assemblyRuns.listStationRuns(
          lostRound.runId,
        );
        const decision = decideArtifactRecovery(
          stationRuns,
          latestRun?.graph ?? null,
          runOpen,
        );

        if (
          decision.kind === "recover" &&
          (await recoverArtifact(
            project,
            feature.id,
            lostRound.round,
            lostRound.runId,
            decision.agentCrName,
          ))
        ) {
          recovered++;
          console.log(
            `[feature-planning-reaper] recovered round ${latest.iteration} for ${row.repo}/${row.id} from the run transcript`,
          );
          continue;
        }
      }

      // isActive probes the agent-cr backend this repo's round ran on — the
      // legacy path for rounds that predate assembly-run execution.
      const station = stationBackend();
      const isActive =
        latest?.status === "running" && latest.task_id
          ? latestRun !== undefined
            ? runOpen
            : await station.isActive(latest.task_id)
          : true;

      const action = decidePlanningRecovery({
        iterations: feature.iterations,
        featureStatus: feature.status,
        isActive,
        nowMs: now,
        runOpen,
      });

      if (action.kind === "orphan") {
        await recoverOrphan(project, feature, action.iteration);
        orphaned++;
        console.log(
          `[feature-planning-reaper] recovered orphaned round ${action.iteration} for ${row.repo}/${row.id}`,
        );
      }

      if (action.kind === "transition") {
        const gap = latest!.gap_result!;

        await project.features.transitionStatus(
          feature.id,
          decideFeatureStatus(gap),
          {
            draft_spec_md: gap.draft_spec_markdown,
          },
        );
        transitioned++;
        console.log(
          `[feature-planning-reaper] applied missed transition for ${row.repo}/${row.id}`,
        );
      }
    } catch (err) {
      console.error(
        `[feature-planning-reaper] ${row.repo}/${row.id}: ${(err as Error).message}`,
      );
    }
  }

  return `Recovered ${orphaned} orphaned round(s), fixed ${transitioned} missed transition(s), replayed ${recovered} lost artifact(s) across ${rows.length} feature(s)`;
}

/** The round + run pair eligible for artifact recovery (#1298): a recent round
 *  with no result whose task ran on an assembly run, while the feature is still
 *  mid-planning. Null otherwise — including for a round that already carries a
 *  result, which needs no archaeology. */
function lostArtifactRound(
  latest: FeatureWithIterations["iterations"][number] | undefined,
  latestRun: { id: string } | undefined,
  featureStatus: string,
): { round: { iteration: number }; runId: string } | null {
  if (!latest || !latestRun || latest.gap_result) {
    return null;
  }

  if (latest.status !== "failed" && latest.status !== "running") {
    return null;
  }

  return isPlanningPhase(featureStatus)
    ? { round: latest, runId: latestRun.id }
    : null;
}

/** How many transcript turns one recovery scan will page through before giving
 *  up — a planning round runs a few hundred turns; this is a runaway bound, not
 *  a tuning knob. */
const RECOVERY_TURN_PAGE = 200;
const RECOVERY_TURN_PAGES_MAX = 25;

/**
 * Re-apply a lost round result from the run transcript (#1298): the terminal
 * `Write` of the watch artifact (`result.json`) holds the full GapResult, and
 * `applyGapResult` is already built for late delivery. Returns false when the
 * run never produced one — a genuinely failed analysis has no artifact and
 * stays failed.
 *
 * `agentCrName` scopes the scan to THIS round's pod (#1302): on a multi-round
 * run the transcript also holds every PREVIOUS round's `result.json`, and an
 * unscoped scan would replay one of those as the current round's result. Null
 * (a work row that never recorded its CR) scans unscoped — the legacy behavior.
 */
async function recoverArtifact(
  project: Project,
  featureId: string,
  latest: { iteration: number },
  runId: string,
  agentCrName: string | null,
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

/**
 * Mark the orphaned round failed, then restore the feature to the state of its
 * last round that actually produced a result (so a prior good analysis isn't
 * lost) — or back to `draft` if none ever did. Skips a feature already past the
 * planning phase so a stale orphan can't drag a finalized feature backwards.
 */
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

  // The orphan is `running`, so latestReadyGap naturally skips it and returns the
  // last round that produced a result — restore that; else fall back to `draft`.
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
