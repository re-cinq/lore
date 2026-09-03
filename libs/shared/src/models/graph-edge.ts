import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/** `memory.edges` — a relationship between two graph entities; carries the same temporal validity as facts (`validFrom`/`validTo`) and names its source episode/memory so it can be traced back to evidence. */

export const GraphEdgeSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  targetId: z.string(),
  relationType: z.string(),
  properties: z.record(z.unknown()).nullable(),
  validFrom: z.date(),
  validTo: z.date().nullable(),
  sourceEpisodeId: z.string().nullable(),
  sourceMemoryId: z.string().nullable(),
  createdAt: z.date(),
});

export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

export const GRAPH_EDGE_COLUMNS = {
  id: "id",
  sourceId: "source_id",
  targetId: "target_id",
  relationType: "relation_type",
  properties: "properties",
  validFrom: "valid_from",
  validTo: "valid_to",
  sourceEpisodeId: "source_episode_id",
  sourceMemoryId: "source_memory_id",
  createdAt: "created_at",
} as const satisfies ColumnMap<GraphEdge>;

export const GRAPH_EDGE_TABLE = "memory.edges";
