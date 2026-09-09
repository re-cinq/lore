import "server-only";
import { apiFetch } from "./client";
import type { ApiResult } from "./result";
import type { components } from "./schema";

// The run page's per-file diff source (specs/assembly-line-run-viz FR8); types alias the generated schema, no hand-mirrored shapes.
export type PullFiles = components["schemas"]["PullFiles"];
export type PullFileChange = PullFiles["files"][number];

export function fetchPullFiles(
  repo: string,
  number: number,
): Promise<ApiResult<PullFiles>> {
  return apiFetch("lore-api", `/api/repos/${repo}/pulls/${number}/files`);
}
