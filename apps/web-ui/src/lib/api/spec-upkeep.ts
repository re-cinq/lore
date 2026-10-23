import "server-only";
import { apiFetch } from "./client";
import type { ApiResult } from "./result";
import type { components } from "./schema";

// The spec upkeep loop in the shared loop sections; types alias the generated schema.
export type SpecUpkeep = components["schemas"]["SpecUpkeep"];
export type UpkeepRow = SpecUpkeep["current"][number];

export function getSpecUpkeep(repo: string): Promise<ApiResult<SpecUpkeep>> {
  return apiFetch("lore-api", `/api/repos/${repo}/spec-upkeep`);
}
