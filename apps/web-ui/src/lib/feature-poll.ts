import { getFeatureStatus } from "@/lib/api/features";
import { runIdOf } from "./api/run-id";
import { getTask } from "@/lib/api/tasks";
import { formatStationConversation } from "@/lib/station-conversation";
import { fetchFeatureRunById, type FeatureRunPayload } from "@/lib/feature-run";
import type { FeatureRow, FeatureIterationRow } from "@/lib/feature-types";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";

// Everything planning wizard needs for 4s polls; exported for API contract parity.

export interface FeaturePollPayload {
  feature: FeatureRow;
  latestIteration: FeatureIterationRow | null;
  task: { status: string; failure_reason: string | null } | null;
  liveOutput: string | null;
  /** Most recent round that produced a result — shown even if the latest failed. */
  lastReady: FeatureIterationRow | null;
  run: FeatureRunPayload | null;
}

/** Local Docker Station's live log for a task (best effort). */
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

/** Poll payload, or null when feature not found. */
export async function loadFeaturePoll(
  fullName: string,
  id: string,
  /** Run whose graph client already holds (avoids re-shipping clone every 4s). */
  haveGraphForRun?: string | null,
): Promise<FeaturePollPayload | null> {
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
    run: await fetchFeatureRunById(runIdOf(status.data), haveGraphForRun),
  };
}
