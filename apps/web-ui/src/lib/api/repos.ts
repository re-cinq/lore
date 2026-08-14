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

/** The onboarding result lore-api answers with when the guard clears. */
export interface OnboardResult {
  repo_id: string;
  task_id: string;
  status: string;
}

/** The 409 body when the guard refuses: which block fired, and the task holding
 *  the repo when that is the reason. */
export interface OnboardBlockedBody {
  blocked: "in-flight" | "already-onboarded" | "pr-open";
  error: string;
  task_id: string | null;
}

/**
 * Queue an `onboard` task for a repo. lore-api owns the duplicate guard: it runs
 * the state read and both writes inside ONE transaction holding a per-repo
 * advisory lock, so concurrent submissions serialize and at most one task is
 * queued. web-ui used to run that same transaction itself against its own mirror
 * of the guard — two copies of a rule whose whole job is to be single.
 */
export function onboardRepo(
  fullName: string,
  options: { reonboard?: boolean } = {},
): Promise<ApiResult<OnboardResult>> {
  return apiFetch("lore-api", "/api/onboard", {
    method: "POST",
    body: { repo: fullName, ...(options.reonboard ? { reonboard: true } : {}) },
  });
}

/** Org-wide `lore.settings` plus the repo count the settings page shows. */
export function getOrgSettings(): Promise<
  ApiResult<{
    settings: { key: string; value: string; updated_at: string }[];
    repo_count: number;
  }>
> {
  return apiFetch("lore-api", "/api/settings");
}

/** Upsert org settings by key. A blank value leaves the stored one alone — the
 *  form posts every field and an untouched secret arrives empty. */
export function putOrgSettings(
  entries: { key: string; value: string }[],
): Promise<ApiResult<{ ok: true }>> {
  return apiFetch("lore-api", "/api/settings", {
    method: "PUT",
    body: { entries },
  });
}

/**
 * The general (non-privileged) repo settings write. lore-api REFUSES a patch
 * touching a privileged dark-factory field (403) — those go through the
 * dark-factory endpoint and its CODEOWNER approval PR.
 */
export function putRepoSettings(
  repo: string,
  patch: { team?: string | null; settings?: Record<string, unknown> },
): Promise<ApiResult<{ ok: true }>> {
  return apiFetch("lore-api", `/api/repos/${repo}/settings`, {
    method: "PUT",
    body: patch,
  });
}
