import "server-only";
import { apiFetch } from "./client";
import { withLimits, type SectionLimits } from "./loops";
import type { ApiResult } from "./result";
import type { components } from "./schema";

// The auto-merge loop in the shared loop sections (specs/protected-branch-merge); types alias the generated schema.
export type AutoMerge = components["schemas"]["AutoMerge"];
export type MergeRow = AutoMerge["current"][number];

export function getAutoMerge(
  repo: string,
  limits?: SectionLimits,
): Promise<ApiResult<AutoMerge>> {
  return apiFetch(
    "lore-api",
    withLimits(`/api/repos/${repo}/auto-merge`, limits),
  );
}
