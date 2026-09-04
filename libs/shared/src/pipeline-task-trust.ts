/** Trust-level task-type gating for pipeline-tasks.ts's createTask: which task types a repo's `settings.trust.level` allows. */

import { enforceTrue } from "./lib/enforce.js";
import type { PgPool } from "./memory-store.js";

/** Trust level → allowed task types (createTask gate reads lore.repos.settings.trust.level). */
// Feature planning is allowed from the docs tier up (ADR-027 / specs/7-feature-planning) — analysis + a spec-doc PR only, no code.
const FEATURE_PLANNING = ["feature-planning"];

// Onboarding is allowed at every tier (docs-only PR, deduped by onboard-guard.ts) — restricting to `full` 500s reonboard on auto-demoted repos.
export const TRUST_LEVELS: Record<string, string[]> = {
  docs: ["gap-fill", "runbook", "onboard", ...FEATURE_PLANNING],
  tests: ["gap-fill", "runbook", "onboard", "review", ...FEATURE_PLANNING],
  implementation: [
    "gap-fill",
    "runbook",
    "onboard",
    "review",
    "implementation",
    "implementation-loop",
    "feature-request",
    "general",
    ...FEATURE_PLANNING,
  ],
  full: [
    "gap-fill",
    "runbook",
    "review",
    "implementation",
    "implementation-loop",
    "feature-request",
    "general",
    "onboard",
    ...FEATURE_PLANNING,
  ],
};

/** Throws when trust level forbids the task type; a missing/unknown level passes (back-compat). Exported so the in-memory task store applies the same gate as {@link createTask}. */
export function enforceTrustAllowsTaskType(
  trustLevel: string | undefined,
  taskType: string,
  repo: string,
): void {
  if (!trustLevel || !TRUST_LEVELS[trustLevel]) {
    return;
  }
  const allowed = TRUST_LEVELS[trustLevel];

  enforceTrue(
    allowed.includes(taskType),
    Error,
    `Task type "${taskType}" not allowed at trust level "${trustLevel}" for ${repo}. Allowed: ${allowed.join(", ")}`,
  );
}

async function trustLevelForRepo(
  pool: PgPool,
  repo: string,
): Promise<string | undefined> {
  const { rows: repoRows } = await pool.query(
    `SELECT settings FROM lore.repos WHERE full_name = $1`,
    [repo],
  );

  if (repoRows.length === 0) {
    return undefined;
  }
  const settings = (repoRows[0].settings as {
    trust?: { level?: string };
  }) || { trust: undefined };

  return settings.trust?.level;
}

function isTrustViolation(err: unknown): err is Error {
  return (
    err instanceof Error && err.message.includes("not allowed at trust level")
  );
}

/** Throw when trust level forbids the task type; any other failure (missing row, read error) is non-fatal. */
export async function enforceRepoTrustForTaskType(
  pool: PgPool,
  repo: string,
  taskType: string,
): Promise<void> {
  try {
    const trustLevel = await trustLevelForRepo(pool, repo);

    enforceTrustAllowsTaskType(trustLevel, taskType, repo);
  } catch (err) {
    if (isTrustViolation(err)) {
      throw err;
    }
    // Non-trust errors are non-fatal
  }
}
