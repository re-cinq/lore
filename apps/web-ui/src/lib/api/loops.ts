import "server-only";
import { apiFetch } from "./client";
import type { ApiResult } from "./result";
import type { components } from "./schema";

// The repository's loops and their switches (specs/implementation-loop FR9, specs/issue-triage FR33); types alias the generated schema.
export type RepoLoops = components["schemas"]["RepoLoops"];
export type RepoLoop = RepoLoops["loops"][number];
export type LoopKey = RepoLoop["key"];
export type LoopSwitch = components["schemas"]["LoopSwitch"];

const path = (repo: string) => `/api/repos/${repo}/loops`;

/** How many rows of each section the Loops tab asks a loop's route for; Current is always answered whole. */
export type SectionLimits = Partial<
  Record<"backlog" | "parked" | "awaiting_merge" | "recent", number>
>;

/** A loop route's path with the sections' row counts as its query, `?backlog=5&recent=10`. */
export function withLimits(path: string, limits: SectionLimits = {}): string {
  const query = new URLSearchParams(
    Object.entries(limits).map(([key, count]) => [key, String(count)]),
  ).toString();

  return query ? `${path}?${query}` : path;
}

export function getRepoLoops(repo: string): Promise<ApiResult<RepoLoops>> {
  return apiFetch("lore-api", path(repo));
}

/** What a switch asks for. */
export interface SwitchRequest {
  enabled: boolean;
}

export function setLoopEnabled(
  repo: string,
  key: LoopKey,
  request: SwitchRequest,
): Promise<ApiResult<LoopSwitch>> {
  return apiFetch("lore-api", `${path(repo)}/${key}`, {
    method: "PUT",
    body: request,
  });
}
