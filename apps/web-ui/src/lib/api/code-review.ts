import "server-only";
import { apiFetch } from "./client";
import { withLimits, type SectionLimits } from "./loops";
import type { ApiResult } from "./result";
import type { components } from "./schema";

// The code-review loop as the Loops tab shows it (specs/auto-review-loop FR-L1); types alias the generated schema.
export type CodeReview = components["schemas"]["CodeReview"];
export type ReviewRow = CodeReview["current"][number];

export function getCodeReview(
  repo: string,
  limits?: SectionLimits,
): Promise<ApiResult<CodeReview>> {
  return apiFetch(
    "lore-api",
    withLimits(`/api/repos/${repo}/code-review`, limits),
  );
}
