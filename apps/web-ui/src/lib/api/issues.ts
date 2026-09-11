import "server-only";
import { apiFetch } from "./client";
import type { ApiResult } from "./result";
import type { components } from "./schema";

// The issue a run works on, shown on the run page (specs/assembly-line-run-viz FR9); the type aliases the generated schema, no hand mirror.
export type Issue = components["schemas"]["Issue"];

export function fetchIssue(
  repo: string,
  number: number,
): Promise<ApiResult<Issue>> {
  return apiFetch("lore-api", `/api/repos/${repo}/issues/${number}`);
}
