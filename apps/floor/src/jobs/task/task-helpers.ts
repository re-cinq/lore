/**
 * Shared helpers for the task-processing worker + its handlers.
 *
 * Extracted from worker.ts so the dispatcher and the per-handler modules
 * can share these without a worker↔handler import cycle.
 */

import { projectFor } from "../../composition/project-boot.js";
import { taskStore } from "../../kernel/queues.js";
import { prFooter } from "@re-cinq/lore-shared";
import { slugifyTitle } from "@re-cinq/lore-shared/project/features/features-port.js";

// ── Helpers ───────────────────────────────────────────────────────────

/** The task/branch slug: the shared slugger, capped at 30. Two sluggers with two
 *  caps produced two `specs/<slug>` directories for one title depending on which
 *  path created the feature — and the trailing-dash trim existed only here, so
 *  the other could still end a slug in `-` at its own cut. */
export function slugify(text: string): string {
  return slugifyTitle(text, 30);
}

// ── Status transition helpers ─────────────────────────────────────────

// Both go through `taskStore()` — the SAME PgTaskStore the agent-watcher writes
// its transitions through, over the same pool. They used to call
// setTaskStatus/recordTaskEvent against `getPool()` directly, which is the same
// SQL by a second route: a test double for `taskStore()` then covered only half
// the Floor's status transitions while these five handlers still hit the pool.
// One writer, one seam to stub.
export function setStatus(
  taskId: string,
  status: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  return taskStore().setStatus(taskId, status, extra);
}

export function insertEvent(
  taskId: string,
  fromStatus: string,
  toStatus: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  return taskStore().recordEvent(taskId, fromStatus, toStatus, metadata);
}

/**
 * After a PR is created, update the linked GitHub Issue with the PR reference.
 */
export async function linkPrToIssue(
  repo: string,
  issueNumber: number | null,
  prUrl: string,
): Promise<void> {
  if (!issueNumber) {
    return;
  }

  try {
    const project = await projectFor(repo);

    await project.issues.comment(issueNumber, `PR created: ${prUrl}`);
  } catch {
    /* best effort */
  }
}

/**
 * Get the PR footer with optional `Closes #N` and required `Lore-Task: <uuid>`
 * (T047 / FR1.5). Sourced from `@re-cinq/lore-shared` (pr-body) for reuse
 * across the agent.
 */
export function issueRef(issueNumber: number | null, taskId: string): string {
  return prFooter({ issueNumber, taskId });
}
