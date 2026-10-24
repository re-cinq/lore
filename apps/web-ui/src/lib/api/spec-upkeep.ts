import "server-only";
import { apiFetch } from "./client";
import { withLimits, type SectionLimits } from "./loops";
import type { ApiResult } from "./result";
import type { components } from "./schema";

// The spec upkeep loop in the shared loop sections; types alias the generated schema.
export type SpecUpkeep = components["schemas"]["SpecUpkeep"];
export type UpkeepRow = SpecUpkeep["current"][number];

export function getSpecUpkeep(
  repo: string,
  limits?: SectionLimits,
): Promise<ApiResult<SpecUpkeep>> {
  return apiFetch(
    "lore-api",
    withLimits(`/api/repos/${repo}/spec-upkeep`, limits),
  );
}
