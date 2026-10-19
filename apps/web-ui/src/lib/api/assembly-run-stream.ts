import { apiFetch } from "./client";
import type { ApiResult } from "./result";
import type { components } from "./schema";

export type RunStreamToken = components["schemas"]["RunStreamToken"];

/** A short-lived token that opens this run's channel of the live socket as this person; the caller has already checked their access to the run's repo. */
export function mintRunStreamToken(
  runId: string,
  user: { id: string; name: string },
): Promise<ApiResult<RunStreamToken>> {
  return apiFetch(
    "lore-api",
    `/api/assembly-runs/${encodeURIComponent(runId)}/stream-token`,
    { method: "POST", body: { user } },
  );
}
