import { apiFetch } from "./client";
import type { ApiResult } from "./result";
import type { components } from "./schema";

/** What the last sync of the client's pack repo did (`lore.settings` key `pack.sync`, specs/client-packs). */
export type PackSync = NonNullable<
  components["schemas"]["OrgSettings"]["pack_sync"]
>;

/** Runs a pack sync now, the same one a push to the pack repo starts. */
export function syncPackNow(): Promise<ApiResult<unknown>> {
  return apiFetch("lore-api", "/api/pack/sync", { method: "POST" });
}
