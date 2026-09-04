import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/** `lore.catalog_apply_status` (migration `0056`) — one cluster's current verdict on one catalog definition; no PK column, identity is the (clusterAgentId, name, project) unique index. */

export const CatalogApplyStateSchema = z.enum([
  "applied",
  "refused",
  "skipped",
  "deleted",
]);

export const CatalogApplyStatusSchema = z.object({
  clusterAgentId: z.string(),
  name: z.string(),
  projectId: z.string().nullable(),
  state: CatalogApplyStateSchema,
  reason: z.string().nullable(),
  updatedAt: z.date(),
});

export type CatalogApplyState = z.infer<typeof CatalogApplyStateSchema>;
export type CatalogApplyStatusRow = z.infer<typeof CatalogApplyStatusSchema>;

export const CATALOG_APPLY_STATUS_COLUMNS = {
  clusterAgentId: "cluster_agent_id",
  name: "name",
  projectId: "project_id",
  state: "state",
  reason: "reason",
  updatedAt: "updated_at",
} as const satisfies ColumnMap<CatalogApplyStatusRow>;

export const CATALOG_APPLY_STATUS_TABLE = "lore.catalog_apply_status";
