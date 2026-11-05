import "server-only";
import { apiFetch } from "./client";
import type { ApiResult } from "./result";
import type { components } from "./schema";

// A repository's changelog, a page of weeks at a time (specs/repo-changelog FR6); types alias the generated schema.
export type ChangelogPage = components["schemas"]["ChangelogPage"];
export type ChangelogWeek = ChangelogPage["weeks"][number];
export type ChangelogChange = ChangelogWeek["changes"][number];
export type ChangelogIntroStarted =
  components["schemas"]["ChangelogIntroStarted"];

export function getChangelog(
  repo: string,
  { before }: { before?: string } = {},
): Promise<ApiResult<ChangelogPage>> {
  const query = before ? `?before=${encodeURIComponent(before)}` : "";

  return apiFetch("lore-api", `/api/repos/${repo}/changelog${query}`);
}

/** Starts the finished week's weekly-changelog run again, so its introduction is written. */
export function writeChangelogIntro(
  repo: string,
  week: string,
): Promise<ApiResult<ChangelogIntroStarted>> {
  return apiFetch("lore-api", `/api/repos/${repo}/changelog/${week}/intro`, {
    method: "POST",
  });
}
