// The repo as the backlog reads it: its settings, and the onboarding state that decides whether the loop can pick for it at all.

import type { Pool } from "pg";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import {
  fromRow,
  pickColumns,
  selectList,
  type DbRow,
} from "@re-cinq/lore-shared/lib/row.js";
import { REPO_COLUMNS, type Repo } from "@re-cinq/lore-shared/models/repo.js";
import {
  PIPELINE_TASK_COLUMNS,
  type PipelineTask,
} from "@re-cinq/lore-shared/models/pipeline-task.js";
import type { Onboarding } from "./backlog-schema.js";

/** The repo columns the backlog reads, picked from the repo model: its settings and whether its onboarding merged. */
const REPO_ONBOARDING_COLUMNS = pickColumns(REPO_COLUMNS, [
  "settings",
  "onboardingPrMerged",
  "onboardingPrUrl",
] as const);

/** The onboard-task columns the backlog reads, picked from the task model. */
const ONBOARD_TASK_COLUMNS = pickColumns(PIPELINE_TASK_COLUMNS, [
  "id",
  "status",
  "failureReason",
] as const);

/** The repo and its newest onboard task, as the models name them. */
export interface RepoRead {
  repo: Pick<Repo, "settings" | "onboardingPrMerged" | "onboardingPrUrl">;
  task: Pick<PipelineTask, "id" | "status" | "failureReason"> | null;
}

/** One statement, so reading the onboarding state costs the page no extra round trip: the newest onboard task rides along as a lateral join. */
const REPO_ROW_SQL = `SELECT ${selectList(REPO_ONBOARDING_COLUMNS, "r")}, ${selectList(ONBOARD_TASK_COLUMNS, "t")}
  FROM lore.repos r
  LEFT JOIN LATERAL (
    SELECT id, status, failure_reason FROM pipeline.tasks
     WHERE target_repo = r.full_name AND task_type = 'onboard'
     ORDER BY created_at DESC LIMIT 1
  ) t ON true
 WHERE r.full_name = $1`;

/** The repo and its newest onboard task, or a 404 — an unknown repo has no backlog to report on. */
export async function readRepoRow(pool: Pool, repo: string): Promise<RepoRead> {
  const { rows } = await pool.query<DbRow>(REPO_ROW_SQL, [repo]);

  enforceTrue(rows.length > 0, apiError(404), `repo not found: ${repo}`);
  const row = rows[0];

  return {
    repo: fromRow<RepoRead["repo"]>(REPO_ONBOARDING_COLUMNS, row),
    task: row.id
      ? fromRow<NonNullable<RepoRead["task"]>>(ONBOARD_TASK_COLUMNS, row)
      : null,
  };
}

/** Whether onboarding merged, the open onboarding PR, and the newest onboard task. A merged onboarding hides its PR url, as the onboard guard does. */
export function onboardingOf({ repo, task }: RepoRead): Onboarding {
  const merged = repo.onboardingPrMerged === true;

  return {
    merged,
    pr_url: merged ? null : (repo.onboardingPrUrl ?? null),
    last_task: task
      ? {
          id: task.id,
          status: task.status,
          failure_reason: task.failureReason ?? null,
        }
      : null,
  };
}
