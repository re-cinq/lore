import "server-only";
import { apiFetch } from "./client";
import { withLimits, type SectionLimits } from "./loops";
import type { ApiResult } from "./result";
import type { components } from "./schema";

// Issue triage in the shared loop sections (specs/issue-triage FR28); types alias the generated schema.
export type IssueTriage = components["schemas"]["IssueTriage"];
export type TriageRow = IssueTriage["current"][number];

export function getIssueTriage(
  repo: string,
  limits?: SectionLimits,
): Promise<ApiResult<IssueTriage>> {
  return apiFetch("lore-api", withLimits(`/api/repos/${repo}/triage`, limits));
}
