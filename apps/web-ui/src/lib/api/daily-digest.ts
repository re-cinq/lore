import "server-only";
import { apiFetch } from "./client";
import { withLimits, type SectionLimits } from "./loops";
import type { ApiResult } from "./result";
import type { components } from "./schema";

// The daily digest in the shared loop sections; types alias the generated schema.
export type DailyDigest = components["schemas"]["DailyDigest"];
export type DigestRow = DailyDigest["current"][number];

export function getDailyDigest(
  repo: string,
  limits?: SectionLimits,
): Promise<ApiResult<DailyDigest>> {
  return apiFetch(
    "lore-api",
    withLimits(`/api/repos/${repo}/daily-digest`, limits),
  );
}
