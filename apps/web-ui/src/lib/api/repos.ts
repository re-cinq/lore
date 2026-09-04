import "server-only";
import { apiFetch } from "./client";
import type { ApiResult } from "./result";
import type { components } from "./schema";

// `lore.repos` reads, typed once — replaces nine call sites' own SELECTs. RepoRecord aliases the libs/shared model via openapi.json/schema.d.ts; timestamps arrive as ISO strings (server types them as Date).
export type RepoRecord = components["schemas"]["Repo"];

/** A repo row plus the pipeline counts the repo list renders beside it. */
export type RepoWithCounts = components["schemas"]["RepoList"]["repos"][number];

/** One repo row; no row is a 404 result, not a throw — pages render "not found" rather than crashing the route. */
export function getRepo(fullName: string): Promise<ApiResult<RepoRecord>> {
  return apiFetch("lore-api", `/api/repos/${fullName}`);
}

/** ONE page of onboarded repos, newest first, at most `MAX_PAGE_LIMIT` rows — see {@link listAllRepos}. */
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

/** lore-api CLAMPS `limit` to this (mirrors `MAX_PAGE_LIMIT`) — a bigger ask is silently trimmed; paging is the only way past it. */
const PAGE = 100;

/** EVERY onboarded repo, paged past `/api/repos`'s 100-row clamp; a failed page returns the FAILURE, never rows gathered so far, so a short list can't pass as complete. */
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

    // An empty page ends the walk even when `total` disagrees — a stale count (repo deleted mid-read) would otherwise loop forever.
    if (page.data.repos.length === 0 || repos.length >= total) {
      return { status: "ok", data: { repos, total } };
    }
  }
}

/** Throws naming why, rather than answering `[]` on an unreachable lore-api — an outage must not render as "no repos" (worst on the home page's onboard-your-first-repo empty state). */
export function reposOrThrow<T>(result: ApiResult<T>): T {
  if (result.status !== "ok") {
    throw new Error(
      `repo list unavailable: ${
        result.status === "error"
          ? result.message
          : "LORE_API_URL not configured"
      }`,
    );
  }

  return result.data;
}

/** The onboarding result lore-api answers with when the guard clears. */
export type OnboardResult = Extract<
  components["schemas"]["OnboardResult"],
  { repo_id: string }
>;

/** The 409 body when the guard refuses: which block fired, and the task holding the repo when that is the reason. */
export interface OnboardBlockedBody {
  blocked: "in-flight" | "already-onboarded" | "pr-open";
  error: string;
  task_id: string | null;
}

/** Queues an `onboard` task; lore-api owns the duplicate guard (one transaction, per-repo advisory lock) — web-ui used to run its own mirror of that same rule. */
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

/** Upsert org settings by key — a blank value leaves the stored one alone, since the form posts every field and an untouched secret arrives empty. */
export function putOrgSettings(
  entries: { key: string; value: string }[],
): Promise<ApiResult<{ ok: true }>> {
  return apiFetch("lore-api", "/api/settings", {
    method: "PUT",
    body: { entries },
  });
}

/** General (non-privileged) repo settings write — lore-api REFUSES a patch touching a privileged dark-factory field (403); those go through its own endpoint + CODEOWNER approval PR. */
export function putRepoSettings(
  repo: string,
  patch: { team?: string | null; settings?: Record<string, unknown> },
): Promise<ApiResult<{ ok: true }>> {
  return apiFetch("lore-api", `/api/repos/${repo}/settings`, {
    method: "PUT",
    body: patch,
  });
}
