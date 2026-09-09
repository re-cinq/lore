import "server-only";
import { apiFetch } from "./client";
import type { ApiResult } from "./result";
import type { components } from "./schema";

// The run's Definition of Done with CI progress (specs/implementation-loop FR16); the type aliases the generated schema, no hand mirror.
export type DodProgress = components["schemas"]["DodProgress"];

export type AcceptanceTestStatus = NonNullable<
  DodProgress["acceptanceTests"]
>[number];

export function fetchDodProgress(
  runId: string,
): Promise<ApiResult<DodProgress>> {
  return apiFetch(
    "lore-api",
    `/api/assembly-runs/${encodeURIComponent(runId)}/dod`,
  );
}
