import "server-only";
import { apiFetch } from "./client";
import type { ApiResult } from "./result";
import type { components } from "./schema";

// The `lore.repos` reads, typed once. Nine call sites across five files each ran
// their own `SELECT … FROM lore.repos WHERE full_name = $1`, differing only in
// which columns they asked for; `getRepo` serves the record and each caller
// picks what it needs.

// The row shape is NOT restated here. `Repo` is declared once as a model in
// libs/shared, published into openapi.json by the route that serves it, and
// generated into ./schema.d.ts — so this is an alias, not a mirror to keep in
// sync. Timestamps arrive as ISO strings because that is what JSON carries; the
// server-side model types them as Date.
export type RepoRecord = components["schemas"]["Repo"];

/** A repo row plus the pipeline counts the repo list renders beside it. */
export type RepoWithCounts = components["schemas"]["RepoList"]["repos"][number];

/** One repo row. A repo with no row is a 404 result, not a throw — the pages
 *  that read it render "not found" rather than crashing the route. */
export function getRepo(fullName: string): Promise<ApiResult<RepoRecord>> {
  return apiFetch("lore-api", `/api/repos/${fullName}`);
}

/** ONE page of onboarded repos, newest first, each row carrying its task count.
 *  Answers at most `MAX_PAGE_LIMIT` rows — see {@link listAllRepos}. */
export function listRepos(
  limit?: number,
  offset?: number,
): Promise<ApiResult<{ repos: RepoWithCounts[]; total: number }>> {
  const query =
    limit === undefined && offset === undefined
      ? ""
      : `?limit=${limit ?? PAGE}&offset=${offset ?? 0}`;

  return apiFetch("lore-api", `/api/repos${query}`);
}

/** lore-api CLAMPS `limit` to this, so a bigger ask is silently trimmed rather
 *  than honoured — paging is the only way past it. Mirrors `MAX_PAGE_LIMIT`. */
const PAGE = 100;

/**
 * EVERY onboarded repo, paged.
 *
 * `/api/repos` clamps its limit at 100, so a caller that wants a complete list —
 * a repo picker, a filter dropdown — cannot ask for one. Reading a single page
 * and treating it as the whole set loses every repo past the hundredth, with
 * nothing in the UI to say so.
 *
 * A failed page returns the FAILURE, never the rows gathered so far: a short
 * list is indistinguishable from a complete one at the call site, which is the
 * bug this exists to prevent.
 */
export async function listAllRepos(): Promise<
  ApiResult<{ repos: RepoWithCounts[]; total: number }>
> {
  const repos: RepoWithCounts[] = [];

  for (;;) {
    const page = await listRepos(PAGE, repos.length);

    if (page.status !== "ok") {
      return page;
    }
    const { total } = page.data;

    repos.push(...page.data.repos);

    // An empty page ends the walk even when `total` disagrees — a count that
    // outruns the rows (a repo deleted mid-read) would otherwise loop forever.
    if (page.data.repos.length === 0 || repos.length >= total) {
      return { status: "ok", data: { repos, total } };
    }
  }
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
