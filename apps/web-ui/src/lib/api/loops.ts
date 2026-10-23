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

export function getRepoLoops(repo: string): Promise<ApiResult<RepoLoops>> {
  return apiFetch("lore-api", path(repo));
}

/** What a switch asks for; switching auto merge on also names the two-key approval PR (`owner/repo#n`). */
export interface SwitchRequest {
  enabled: boolean;
  approvalPr?: string;
}

export function setLoopEnabled(
  repo: string,
  key: LoopKey,
  { enabled, approvalPr }: SwitchRequest,
): Promise<ApiResult<LoopSwitch>> {
  return apiFetch("lore-api", `${path(repo)}/${key}`, {
    method: "PUT",
    body: { enabled },
    ...(approvalPr ? { headers: { "x-lore-approval-pr": approvalPr } } : {}),
  });
}
