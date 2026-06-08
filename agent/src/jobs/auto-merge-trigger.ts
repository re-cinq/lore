/**
 * Watcher-side auto-merge trigger. Closes the gap left open by
 * PR #310: the cluster-path runner-cli intentionally does NOT call
 * evaluateAndMerge inside the Job pod (the loretask-watcher owns PR
 * creation; firing from inside the pod would race the watcher). This
 * module is invoked by the watcher AFTER the PR is created and
 * pipeline.tasks has been updated with pr_number.
 *
 * Flow:
 *  1. Look up the task's repo settings.
 *  2. If dark mode is off → return null (no audit row written).
 *     Avoids cluttering pipeline.audit_log with deferred:dark_mode_off
 *     entries for every legacy-path task.
 *  3. Build policy via resolvePrForTaskFromDb (same lookup the in-agent
 *     retrospective handler uses — single source of truth).
 *  4. Delegate to evaluateAndMerge, which writes the audit row and
 *     performs the merge call when the policy allows.
 *
 * Lives in its own module (separate from auto-merge.ts) so unit tests
 * can vi.mock evaluateAndMerge — vi.mock can't intercept an in-module
 * direct call, only cross-module imports.
 */
import { Octokit } from "octokit";
import { resolveDarkFactorySettings } from "@re-cinq/lore-shared";
import { query } from "../db.js";
import { buildOctokit, resolvePrForTaskFromDb } from "../lib/pr-policy.js";
import { evaluateAndMerge, type AutoMergeDecision } from "./auto-merge.js";

export async function tryAutoMergeForCompletedTask(opts: {
  taskId: string;
  octokit?: Octokit;
}): Promise<AutoMergeDecision | null> {
  // Resolve the repo's dark-factory settings before paying the cost
  // of an Octokit handshake or a GitHub API round-trip.
  const rows = await query<{
    target_repo: string | null;
    settings: { dark_factory?: unknown } | null;
  }>(
    `SELECT t.target_repo, r.settings
       FROM pipeline.tasks t
       LEFT JOIN lore.repos r ON r.full_name = t.target_repo
      WHERE t.id = $1`,
    [opts.taskId],
  );
  const row = rows[0];
  if (!row?.target_repo) return null;

  const settings = resolveDarkFactorySettings(
    (row.settings?.dark_factory as Parameters<
      typeof resolveDarkFactorySettings
    >[0]) ?? null,
  );
  if (!settings.enabled) return null;

  const octokit = opts.octokit ?? buildOctokit();
  const pr = await resolvePrForTaskFromDb(opts.taskId, settings, octokit);
  if (!pr) return null;

  return evaluateAndMerge({
    taskId: opts.taskId,
    repo: pr.repo,
    prNumber: pr.prNumber,
    policy: pr.policy,
  });
}
