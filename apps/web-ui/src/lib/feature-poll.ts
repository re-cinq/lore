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

type PollTask = { status: string; failure_reason: string | null };

async function resolveTask(
  taskId: string | null | undefined,
): Promise<PollTask | null> {
  if (!taskId) {
    return null;
  }
  const row = await getTask(taskId);

  if (row.status !== "ok") {
    return null;
  }
  const taskRow = row.data as unknown as {
    status: string;
    failure_reason?: string | null;
  };

  return {
    status: taskRow.status,
    failure_reason: taskRow.failure_reason ?? null,
  };
}

function liveOutputFor(
  taskId: string | null | undefined,
  taskStatus: string | undefined,
): string | null {
  if (!taskId || taskStatus !== "running") {
    return null;
  }

  return liveStationLog(taskId);
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
  const task = await resolveTask(latestIteration?.task_id);

  return {
    feature,
    latestIteration,
    task,
    liveOutput: liveOutputFor(latestIteration?.task_id, task?.status),
    lastReady: last_ready_iteration,
    run: await fetchFeatureRunById(runIdOf(status.data), haveGraphForRun),
  };
}
