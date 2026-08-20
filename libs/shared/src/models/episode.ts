import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/**
 * `memory.episodes` — a raw text blob ingested for passive fact extraction.
 *
 * DDL: `scripts/infra/setup-memory-schema.sh`. `contentHash` carries the
 * idempotency: `(agentId, contentHash)` is unique, so re-ingesting the same
 * conversation turn is a no-op rather than a duplicate. `embedding` is excluded
 * as on the other memory models.
 */

export const EpisodeSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  content: z.string(),
  contentHash: z.string(),
  source: z.string(),
  ref: z.string().nullable(),
  createdAt: z.date(),
});

export type Episode = z.infer<typeof EpisodeSchema>;

export const EPISODE_COLUMNS = {
  id: "id",
  agentId: "agent_id",
  content: "content",
  contentHash: "content_hash",
  source: "source",
  ref: "ref",
  createdAt: "created_at",
} as const satisfies ColumnMap<Episode>;

export const EPISODE_TABLE = "memory.episodes";
