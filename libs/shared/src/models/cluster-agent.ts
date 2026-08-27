import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/**
 * `pipeline.cluster_agents` — one registered execution cluster (the GitLab
 * Runner model for AI stations, specs/running-stations-in-any-k8s-cluster).
 *
 * DDL: `NNNN_cluster_agent_registry.sql` migration. The table stores a
 * SHA-256 `tokenHash`, never the token: the plaintext exists once, in the
 * register response. `status` is reaper-owned liveness (`active`/`offline`),
 * derived from `lastSeenAt`, never set by the agent itself.
 *
 * `paused` is the OPERATOR's switch and deliberately not part of `status`: a
 * paused agent is alive, heartbeating and finishing what it holds — it is only
 * passed over when new work is handed out. An offline one is gone, and its
 * claims are requeued. Same page, opposite meanings.
 */

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
} as const satisfies ColumnMap<ClusterAgent>;

export const CLUSTER_AGENT_TABLE = "pipeline.cluster_agents";
