// Shared helpers for the task-processing worker + its handlers, extracted from worker.ts to avoid a worker↔handler import cycle.

import { projectFor } from "../../kernel/project-boot.js";
import { taskStore } from "../../kernel/queues.js";
import { prFooter } from "@re-cinq/lore-shared";
import { slugifyTitle } from "@re-cinq/lore-shared/project/features/features-port.js";

// ── Helpers ───────────────────────────────────────────────────────────

// The task/branch slug: the shared slugger, capped at 30 — two sluggers with two caps once produced two `specs/<slug>` directories for one title, and a dash-trim that existed only here let the other end a slug in `-`.
export function slugify(text: string): string {
  return slugifyTitle(text, 30);
}

// ── Status transition helpers ─────────────────────────────────────────

// Both go through `taskStore()` — the SAME PgTaskStore the agent-watcher writes through; they used to call setTaskStatus/recordTaskEvent against getPool() directly, so a test double for taskStore() covered only half the Floor's status transitions.
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

// After a PR is created, update the linked GitHub Issue with the PR reference.
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

// Get the PR footer with optional `Closes #N` and required `Lore-Task: <uuid>` (T047/FR1.5); sourced from @re-cinq/lore-shared (pr-body) for reuse across the agent.
export function issueRef(issueNumber: number | null, taskId: string): string {
  return prFooter({ issueNumber, taskId });
}
