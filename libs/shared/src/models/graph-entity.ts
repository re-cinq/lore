import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/**
 * `memory.entities` — a node of the live knowledge graph (a service, team,
 * technology), updated incrementally on every episode write.
 *
 * DDL: `scripts/infra/setup-memory-schema.sh`. `(name, entityType, repo)` is
 * unique, which is what makes the graph converge instead of accumulating
 * near-duplicate nodes.
 */

export const GraphEntitySchema = z.object({
  id: z.string(),
  name: z.string(),
  entityType: z.string(),
  properties: z.record(z.unknown()).nullable(),
  repo: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type GraphEntity = z.infer<typeof GraphEntitySchema>;

export const GRAPH_ENTITY_COLUMNS = {
  id: "id",
  name: "name",
  entityType: "entity_type",
  properties: "properties",
  repo: "repo",
  createdAt: "created_at",
  updatedAt: "updated_at",
} as const satisfies ColumnMap<GraphEntity>;

export const GRAPH_ENTITY_TABLE = "memory.entities";
