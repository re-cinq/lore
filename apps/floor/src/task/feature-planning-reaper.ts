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

import { query } from "../kernel/db.js";
import { projectFor, stationBackend } from "../composition/project-boot.js";
import {
  decidePlanningRecovery,
  latestReadyGap,
  type FeatureWithIterations,
} from "@re-cinq/lore-shared/project/features/features-port.js";
import { decideFeatureStatus, isPlanningPhase } from "@re-cinq/lore-shared/feature-planning/gap-result.js";

type Project = Awaited<ReturnType<typeof projectFor>>;

interface Candidate {
  id: string;
  repo: string;
}

export async function featurePlanningReaperJob(): Promise<string> {
  const rows = await query<Candidate>(
    `SELECT DISTINCT f.id, f.repo
       FROM lore.features f
       JOIN lore.feature_iterations i ON i.feature_id = f.id
      WHERE i.status = 'running'
         OR (i.status = 'ready' AND f.status = 'planning')`,
  );
  if (rows.length === 0) return "No stuck planning features";

  const now = Date.now();
  let orphaned = 0;
  let transitioned = 0;

  for (const row of rows) {
    try {
      const project = await projectFor(row.repo);
      const feature = await project.features.get(row.id);
      if (!feature) continue;

      // isActive probes the agent-cr backend this repo's round ran on.
      const station = stationBackend();
      const latest = feature.iterations[feature.iterations.length - 1];
      const isActive =
        latest?.status === "running" && latest.task_id ? await station.isActive(latest.task_id) : true;

      const action = decidePlanningRecovery({
        iterations: feature.iterations,
        featureStatus: feature.status,
        isActive,
        nowMs: now,
      });

      if (action.kind === "orphan") {
        await recoverOrphan(project, feature, action.iteration);
        orphaned++;
        console.log(`[feature-planning-reaper] recovered orphaned round ${action.iteration} for ${row.repo}/${row.id}`);
      } else if (action.kind === "transition") {
        const gap = latest!.gap_result!;
        await project.features.transitionStatus(feature.id, decideFeatureStatus(gap), {
          draft_spec_md: gap.draft_spec_markdown,
        });
        transitioned++;
        console.log(`[feature-planning-reaper] applied missed transition for ${row.repo}/${row.id}`);
      }
    } catch (err) {
      console.error(`[feature-planning-reaper] ${row.repo}/${row.id}: ${(err as Error).message}`);
    }
  }

  return `Recovered ${orphaned} orphaned round(s), fixed ${transitioned} missed transition(s) across ${rows.length} feature(s)`;
}

/**
 * Mark the orphaned round failed, then restore the feature to the state of its
 * last round that actually produced a result (so a prior good analysis isn't
 * lost) — or back to `draft` if none ever did. Skips a feature already past the
 * planning phase so a stale orphan can't drag a finalized feature backwards.
 */
async function recoverOrphan(project: Project, feature: FeatureWithIterations, iteration: number): Promise<void> {
  await project.features.setIterationResult(feature.id, iteration, null, "failed");
  if (!isPlanningPhase(feature.status)) return;

  // The orphan is `running`, so latestReadyGap naturally skips it and returns the
  // last round that produced a result — restore that; else fall back to `draft`.
  const lastGood = latestReadyGap(feature.iterations);
  if (lastGood) {
    await project.features.transitionStatus(feature.id, decideFeatureStatus(lastGood), {
      draft_spec_md: lastGood.draft_spec_markdown,
    });
  } else {
    await project.features.transitionStatus(feature.id, "draft");
  }
}
