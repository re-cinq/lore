import { getFeatureStatus } from "@/lib/api/features";
import { getTask } from "@/lib/api/tasks";
import { formatStationConversation } from "@/lib/station-conversation";
import { fetchFeatureRunById, type FeatureRunPayload } from "@/lib/feature-run";
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
  // One call for the row, its latest round, and the most recent round that
  // produced a result — lore-api built this endpoint for exactly this 4s poll,
  // and it deliberately omits every round's gap_result (mockup markup plus a
  // repo stylesheet each), which the full feature read would re-send every four
  // seconds.
  const status = await getFeatureStatus(fullName, id);

  if (status.status !== "ok") {
    return null;
  }
  const {
    feature,
    latest_iteration: latestIteration,
    last_ready_iteration,
  } = status.data;
  let task: { status: string; failure_reason: string | null } | null = null;

  if (latestIteration?.task_id) {
    // Surface the task's status/failure so the wizard shows a failure and a retry
    // even when a hard crash left the iteration stuck at 'running'.
    const row = await getTask(latestIteration.task_id);

    task =
      row.status === "ok"
        ? {
            status: row.data.status,
            failure_reason:
              (row.data as unknown as { failure_reason?: string | null })
                .failure_reason ?? null,
          }
        : null;
  }

  return {
    feature,
    latestIteration,
    task,
    liveOutput:
      latestIteration?.task_id && task?.status === "running"
        ? liveStationLog(latestIteration.task_id)
        : null,
    lastReady: last_ready_iteration,
    // The endpoint already resolved which line the graph hangs on: from round 2
    // a resumed round mints no task, so only the OWNING task can resolve it and
    // the server is the one that knows which that was.
    run: await fetchFeatureRunById(status.data.assembly_line_id),
  };
}
