import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/** `pipeline.cluster_agents` — one registered execution cluster (the GitLab-Runner model for AI stations, specs/running-stations-in-any-k8s-cluster); stores SHA-256 `tokenHash` only, `status` is reaper-owned liveness, and `paused` is the operator's separate switch (paused = alive but skipped for new work; offline = gone, claims requeued). */

export const ClusterAgentStatusSchema = z.enum(["active", "offline"]);

export type ClusterAgentStatus = z.infer<typeof ClusterAgentStatusSchema>;

export const ClusterAgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  tags: z.array(z.string()),
  tokenHash: z.string(),
  registeredAt: z.date(),
  lastSeenAt: z.date(),
  status: ClusterAgentStatusSchema,
  paused: z.boolean(),
  clusterInfo: z.record(z.string(), z.unknown()).nullable(),
  /** High-water mark over `lore.catalog_events` (string-encoded bigint); NULL means never resynced, so the catalog-events endpoint sends a full snapshot instead of a tail. */
  catalogCursor: z.string().nullable(),
});

export type ClusterAgent = z.infer<typeof ClusterAgentSchema>;

export const CLUSTER_AGENT_COLUMNS = {
  id: "id",
  name: "name",
  tags: "tags",
  tokenHash: "token_hash",
  registeredAt: "registered_at",
  lastSeenAt: "last_seen_at",
  status: "status",
  paused: "paused",
  clusterInfo: "cluster_info",
  catalogCursor: "catalog_cursor",
} as const satisfies ColumnMap<ClusterAgent>;

export const CLUSTER_AGENT_TABLE = "pipeline.cluster_agents";
