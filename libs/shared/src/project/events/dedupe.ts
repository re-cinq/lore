/**
 * Pure dedupe-key derivations, one per producer source. Producers insert with
 * `ON CONFLICT (dedupe_key) DO NOTHING`, so the key is the at-most-once contract:
 * a GitHub redelivery, a repeated k8s MODIFIED, a scheduler restart replay, or a
 * double post-ingest all collapse to a single event row.
 */

/** Floor a timestamp to the minute, e.g. 2026-06-29T10:15:42.123Z -> 2026-06-29T10:15Z. */
function flooredMinute(at: Date): string {
  return `${at.toISOString().slice(0, 16)}Z`;
}

/** GitHub sends a unique X-GitHub-Delivery uuid, stable across its own retries. */
export function githubDedupeKey(deliveryId: string): string {
  return `github:${deliveryId}`;
}

/** One event per Agent CR per terminal phase (the CR re-emits MODIFIED repeatedly). */
export function k8sDedupeKey(taskId: string, phase: string): string {
  return `k8s:${taskId}:${phase}`;
}

/** Assembly-line node CRs dedupe per CR NAME, not per task: every node CR of one
 *  line shares the synthetic task-id label, so a task-keyed dedupe would swallow
 *  the second node's terminal event. CR names are per-attempt-unique. */
export function k8sAgentNodeDedupeKey(
  agentName: string,
  phase: string,
): string {
  return `k8s:${agentName}:${phase}`;
}

/** One tick per cron slot — collapses checkMissedRuns replay with the live tick. */
export function cronDedupeKey(job: string, at: Date): string {
  return `cron:${job}:${flooredMinute(at)}`;
}
