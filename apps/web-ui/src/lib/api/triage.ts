import "server-only";
import { apiFetch } from "./client";
import type { ApiResult } from "./result";
import type { components } from "./schema";

export type TriageIssues = components["schemas"]["TriageIssues"];
export type TriageIssue = TriageIssues[number];

export function getTriageIssues(
  repo: string,
): Promise<ApiResult<TriageIssues>> {
  return apiFetch("lore-api", `/api/repos/${repo}/triage`);
}
