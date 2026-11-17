import { z } from "zod";

/** The `pack.sync` value of `lore.settings` (specs/client-packs): what the last sync of the client's pack repo did. JSON storage, so keys stay snake_case. A failed sync keeps the last good commit, counts and lists and adds `error`. */
export const PackSyncStateSchema = z.object({
  repo: z.string(),
  ref: z.string().nullable(),
  commit: z.string().nullable(),
  applied_at: z.string().nullable(),
  agent_count: z.number().int().min(0),
  line_count: z.number().int().min(0),
  extra_count: z.number().int().min(0),
  refused_files: z.array(z.object({ path: z.string(), reason: z.string() })),
  /** The agents the pack set, shipped or new: the org defaults the web UI holds read-only. */
  agents: z.array(z.string()),
  /** The pipelines the pack added. */
  pipelines: z.array(z.string()),
  error: z.string().nullable(),
  error_at: z.string().nullable(),
});

export type PackSyncState = z.infer<typeof PackSyncStateSchema>;

export const PACK_SYNC_KEY = "pack.sync";
