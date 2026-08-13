import { queryAllowMissing } from "@/lib/db";
import { formatStationConversation } from "@/lib/station-conversation";
import {
  fetchFeatureRun,
  runTaskIdFor,
  type FeatureRunPayload,
} from "@/lib/feature-run";
import type { FeatureRow, FeatureIterationRow } from "@/lib/feature-types";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";

// Everything the planning wizard's 4s poll needs, in one place.
//
// This used to live inside the route handler, where vitest.config.ts excludes
// `src/app/api/**` from coverage — so ~50 lines of the wizard's data path were
// untested by construction. The handler is now the thin thing it should be:
// authorize, call this, answer.
//
// FeaturePollPayload is exported because PlanningWizard used to carry a private
// `Poll` interface that was a hand copy of this route's response shape — two
// definitions of one contract, in different files, with nothing keeping them in
// step.

export interface FeaturePollPayload {
  feature: FeatureRow;
  latestIteration: FeatureIterationRow | null;
  task: { status: string; failure_reason: string | null } | null;
  liveOutput: string | null;
  /** Most recent round that produced a result — shown even if the latest failed. */
  lastReady: FeatureIterationRow | null;
  run: FeatureRunPayload | null;
}

/** The local Docker Station's live log for a task, as the model's transcript.
 *  Best effort; only the local docker backend writes it. */
function liveStationLog(taskId: string): string | null {
  try {
    const file = path.join(
      os.homedir(),
      ".lore",
      "station-logs",
      `${taskId}.log`,
    );

    return formatStationConversation(fs.readFileSync(file, "utf8")) || null;
  } catch {
    return null;
  }
}

/** The poll payload, or null when the repo has no such feature. */
export async function loadFeaturePoll(
  fullName: string,
  id: string,
): Promise<FeaturePollPayload | null> {
  const features = await queryAllowMissing<FeatureRow>(
    `SELECT * FROM lore.features WHERE id = $1 AND repo = $2`,
    [id, fullName],
  );
  const feature = features[0] ?? null;

  if (!feature) {
    return null;
  }
  const iterations = await queryAllowMissing<FeatureIterationRow>(
    `SELECT * FROM lore.feature_iterations WHERE feature_id = $1 ORDER BY iteration DESC LIMIT 1`,
    [id],
  );
  const latestIteration = iterations[0] ?? null;
  let task: { status: string; failure_reason: string | null } | null = null;

  if (latestIteration?.task_id) {
    // Surface the task's status/failure so the wizard shows a failure and a retry
    // even when a hard crash left the iteration stuck at 'running'.
    const tasks = await queryAllowMissing<{
      status: string;
      failure_reason: string | null;
    }>(`SELECT status, failure_reason FROM pipeline.tasks WHERE id = $1`, [
      latestIteration.task_id,
    ]);

    task = tasks[0] ?? null;
  }
  const ready = await queryAllowMissing<FeatureIterationRow>(
    `SELECT * FROM lore.feature_iterations WHERE feature_id = $1 AND gap_result IS NOT NULL ORDER BY iteration DESC LIMIT 1`,
    [id],
  );
  // The task that OWNS the feature's line — the earliest round that named one. On
  // the merged line a refine is a resume, so every round after the first has a
  // null task_id and only this resolves the line. Narrow select on purpose: this
  // runs every 4s and iteration rows carry gap_result payloads.
  const owning = await queryAllowMissing<{ task_id: string | null }>(
    `SELECT task_id FROM lore.feature_iterations
      WHERE feature_id = $1 AND task_id IS NOT NULL
      ORDER BY iteration ASC LIMIT 1`,
    [id],
  );

  return {
    feature,
    latestIteration,
    task,
    liveOutput:
      latestIteration?.task_id && task?.status === "running"
        ? liveStationLog(latestIteration.task_id)
        : null,
    lastReady: ready[0] ?? null,
    run: await fetchFeatureRun(
      runTaskIdFor({
        latestIterationTaskId: latestIteration?.task_id,
        owningTaskId: owning[0]?.task_id,
      }),
    ),
  };
}
