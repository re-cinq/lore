import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/** Raw text blob for passive fact extraction; (agentId, contentHash) is unique for idempotency. */

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
