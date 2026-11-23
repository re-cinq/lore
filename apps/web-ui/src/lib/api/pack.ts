import { apiFetch } from "./client";
import type { ApiResult } from "./result";
import type { components } from "./schema";

/** What the last sync of the client's pack repo did (`lore.settings` key `pack.sync`, specs/client-packs). */
export type PackSync = NonNullable<
  components["schemas"]["OrgSettings"]["pack_sync"]
>;

/** The client's pack repo this install reads, and its last sync if one has run. */
export type PackState = components["schemas"]["Pack"];

export function getPack(): Promise<ApiResult<PackState>> {
  return apiFetch("lore-api", "/api/pack");
}

const NEVER_SYNCED = {
  commit: null,
  applied_at: null,
  agent_count: 0,
  line_count: 0,
  extra_count: 0,
  refused_files: [],
  agents: [],
  pipelines: [],
  skill_count: 0,
  skills: [],
  error: null,
  error_at: null,
};

/** What the Pack card draws: nothing without a configured pack, an empty sync of it before the first one has run. */
export function packCardState({
  configured,
  repo,
  ref,
  sync,
}: PackState): PackSync | null {
  if (!configured || repo === null) {
    return null;
  }

  return sync ?? { repo, ref, ...NEVER_SYNCED };
}

/** Runs a pack sync now, the same one a push to the pack repo starts. */
export function syncPackNow(): Promise<ApiResult<unknown>> {
  return apiFetch("lore-api", "/api/pack/sync", { method: "POST" });
}
