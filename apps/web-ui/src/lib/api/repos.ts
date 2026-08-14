import "server-only";
import { apiFetch } from "./client";
import type { ApiResult } from "./result";

// The `lore.repos` reads, typed once. Nine call sites across five files each ran
// their own `SELECT … FROM lore.repos WHERE full_name = $1`, differing only in
// which columns they asked for; `getRepo` serves the record and each caller
// picks what it needs.

export interface RepoRecord {
  full_name: string;
  team: string | null;
  settings: Record<string, unknown> | null;
  onboarded_at: string | null;
  last_ingested_at: string | null;
  onboarding_pr_url: string | null;
  onboarding_pr_merged: boolean;
}

/** One repo row. A repo with no row is a 404 result, not a throw — the pages
 *  that read it render "not found" rather than crashing the route. */
export function getRepo(fullName: string): Promise<ApiResult<RepoRecord>> {
  return apiFetch("lore-api", `/api/repos/${fullName}`);
}

/** Every onboarded repo, newest first, each row carrying its task count. */
export function listRepos(): Promise<
  ApiResult<{ repos: (RepoRecord & { task_count?: number })[]; total: number }>
> {
  return apiFetch("lore-api", "/api/repos");
}
