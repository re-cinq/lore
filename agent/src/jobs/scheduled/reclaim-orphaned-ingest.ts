/**
 * Orphan-on-deploy recovery for graph-ingest tasks.
 *
 * When a pod roll (CI deploy, OOM, eviction) kills the worker mid-task, any
 * task it had claimed stays `running` forever — the replacement pod's poller
 * only picks `pending`. `recoverStaleTasks` handles this on STARTUP, but a pod
 * that boots seconds after the roll sees the tasks as not-yet-stale and misses
 * them, and the only other safety net (`stale-task-check`) waits 6h and then
 * escalates to `needs-human-help` — both wrong for a deterministic, idempotent
 * graph-ingest task that should simply re-run.
 *
 * This recurring job resets graph-ingest tasks stuck in `running` (idle past the
 * threshold) back to `pending` so the agent re-runs them. Re-running is a safe
 * no-op for already-projected files (`projectSpecFile`'s content_hash gate).
 * NON-graph-ingest (LLM) tasks are deliberately left to the 6h human-escalation
 * path so a genuinely broken task doesn't re-run-loop.
 */

import { query } from "../../platform/db.js";
import { getTaskTypes, getTaskTypeConfig } from "../../platform/config.js";

const RECLAIM_THRESHOLD_MINUTES = 15;

interface RunningTask {
  id: string;
  task_type: string;
  idle_minutes: number;
}

/** Pure: the ids of graph-ingest tasks idle past the threshold (orphaned). */
export function selectOrphanedIngestTasks(
  running: RunningTask[],
  graphIngestTypes: Set<string>,
  thresholdMinutes: number,
): string[] {
  return running
    .filter((t) => graphIngestTypes.has(t.task_type) && t.idle_minutes >= thresholdMinutes)
    .map((t) => t.id);
}

/** The graph-ingest task types, read from the loaded task-type config. */
function graphIngestTypes(): Set<string> {
  return new Set(getTaskTypes().filter((t) => getTaskTypeConfig(t)?.execution_mode === "graph-ingest"));
}

export async function reclaimOrphanedIngestJob(): Promise<string> {
  const types = graphIngestTypes();
  if (types.size === 0) return "no graph-ingest task types configured";

  const running = await query<{ id: string; task_type: string; idle_minutes: string }>(
    `SELECT id, task_type, EXTRACT(EPOCH FROM (now() - updated_at)) / 60 AS idle_minutes
     FROM pipeline.tasks
     WHERE status = 'running'`,
  );

  const ids = selectOrphanedIngestTasks(
    running.map((r) => ({ id: r.id, task_type: r.task_type, idle_minutes: Number(r.idle_minutes) })),
    types,
    RECLAIM_THRESHOLD_MINUTES,
  );

  for (const id of ids) {
    await query(
      `UPDATE pipeline.tasks SET status = 'pending', updated_at = now() WHERE id = $1 AND status = 'running'`,
      [id],
    );
    await query(
      `INSERT INTO pipeline.task_events (task_id, from_status, to_status, metadata)
       VALUES ($1, 'running', 'pending', $2)`,
      [id, JSON.stringify({ reason: "orphan-recovery", detected_by: "reclaim-orphaned-ingest", idle_threshold_minutes: RECLAIM_THRESHOLD_MINUTES })],
    ).catch(() => {});
    console.log(`[reclaim-ingest] reset orphaned graph-ingest task ${id} → pending`);
  }

  return ids.length ? `reclaimed ${ids.length} orphaned graph-ingest task(s)` : "no orphaned graph-ingest tasks";
}
