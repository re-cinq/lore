/**
 * Shared helpers for the task-processing worker + its handlers.
 *
 * Extracted from worker.ts so the dispatcher and the per-handler modules
 * can share these without a worker↔handler import cycle.
 */

import { getPool } from "../../data/db.js";
import { projectFor } from "../../ports/project-boot.js";
import { prFooter, setTaskStatus, recordTaskEvent } from "@re-cinq/lore-shared";

// ── Helpers ───────────────────────────────────────────────────────────

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

// ── Status transition helpers ─────────────────────────────────────────

// setStatus + insertEvent are single-sourced in @re-cinq/lore-shared
// (pipeline-tasks: setTaskStatus + recordEvent). These thin wrappers keep the
// agent's call sites and bind the agent's pg pool.
export function setStatus(taskId: string, status: string, extra: Record<string, unknown> = {}): Promise<void> {
  return setTaskStatus(getPool(), taskId, status, extra);
}

export function insertEvent(
  taskId: string,
  fromStatus: string,
  toStatus: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  return recordTaskEvent(getPool(), taskId, fromStatus, toStatus, metadata);
}

/**
 * After a PR is created, update the linked GitHub Issue with the PR reference.
 */
export async function linkPrToIssue(
  repo: string,
  issueNumber: number | null,
  prUrl: string,
): Promise<void> {
  if (!issueNumber) return;
  try {
    const project = await projectFor(repo);
    await project.issues.comment(issueNumber, `PR created: ${prUrl}`);
  } catch { /* best effort */ }
}

/**
 * Get the PR footer with optional `Refs #N` and required `Lore-Task: <uuid>`
 * (T047 / FR1.5). Sourced from `@re-cinq/lore-shared` (pr-body) for reuse
 * across the agent.
 */
export function issueRef(issueNumber: number | null, taskId: string): string {
  return prFooter({ issueNumber, taskId });
}
