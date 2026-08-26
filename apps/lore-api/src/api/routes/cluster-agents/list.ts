import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "../../../server/api-error.js";
import type { Request, ResponseToolkit, ServerRoute } from "@hapi/hapi";
import type { Pool } from "pg";
import { z } from "zod";
import type { ClusterAgentsRepository } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agents-port.js";
import { PgClusterAgents } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agents-pg.js";
import type { AssemblyRunsPort } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { PgAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-pg.js";
import type { AuditPort } from "@re-cinq/lore-shared/project/audit/audit-port.js";
import { PgAudit } from "@re-cinq/lore-shared/project/audit/audit-pg.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";

/**
 * GET /api/cluster-agents — the registered-clusters visibility surface (FR7 of
 * specs/running-stations-in-any-k8s-cluster): every registered agent with its
 * open-claim count, plus the recent `cluster_agent_offline` audit entries so a
 * flapping cluster is diagnosable without database access.
 *
 * Unlike its sibling register/claim/heartbeat routes this one serves the UI,
 * not the agents — so auth is the normal scoped-token strategy, not the
 * per-agent token.
 */

const OFFLINE_EVENT_LIMIT = 20;

const ClusterAgentListItem = z.object({
  id: z.string(),
  name: z.string(),
  tags: z.array(z.string()),
  status: z.enum(["active", "offline"]),
  last_seen_at: z.string(),
  running_claims: z.number(),
});

const OfflineEvent = z.object({
  created_at: z.string(),
  cluster_agent_id: z.string().nullable(),
  station_run_id: z.string().nullable(),
  assembly_run_id: z.string().nullable(),
  node_id: z.string().nullable(),
  elapsed_since_claim_ms: z.number().nullable(),
});

const ClusterAgentListResponse = z.object({
  agents: z.array(ClusterAgentListItem),
  offline_events: z.array(OfflineEvent),
});

export type ClusterAgentListBody = z.infer<typeof ClusterAgentListResponse>;

export interface ClusterAgentListDeps {
  agents: Pick<ClusterAgentsRepository, "list">;
  runs: Pick<AssemblyRunsPort, "countOpenClaimsByAgent">;
  audit: Pick<AuditPort, "listRecentByType">;
}

function payloadString(payload: Record<string, unknown>, key: string) {
  const value = payload[key];

  return typeof value === "string" ? value : null;
}

function payloadNumber(payload: Record<string, unknown>, key: string) {
  const value = payload[key];

  return typeof value === "number" ? value : null;
}

/** The handler core, injectable for tests: roster + claim counts + offline log. */
export async function handleClusterAgentList(
  deps: ClusterAgentListDeps,
): Promise<ClusterAgentListBody> {
  const [roster, openClaims, offlineEntries] = await Promise.all([
    deps.agents.list(),
    deps.runs.countOpenClaimsByAgent(),
    deps.audit.listRecentByType("cluster_agent_offline", OFFLINE_EVENT_LIMIT),
  ]);

  return {
    agents: roster.map((agent) => ({
      id: agent.id,
      name: agent.name,
      tags: agent.tags,
      status: agent.status,
      last_seen_at: agent.lastSeenAt.toISOString(),
      running_claims: openClaims[agent.id] ?? 0,
    })),
    offline_events: offlineEntries.map((entry) => ({
      created_at: entry.createdAt.toISOString(),
      cluster_agent_id: payloadString(entry.payload, "cluster_agent_id"),
      station_run_id: payloadString(entry.payload, "station_run_id"),
      assembly_run_id: payloadString(entry.payload, "assembly_run_id"),
      node_id: payloadString(entry.payload, "node_id"),
      elapsed_since_claim_ms: payloadNumber(
        entry.payload,
        "elapsed_since_claim_ms",
      ),
    })),
  };
}

export function clusterAgentListRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/cluster-agents",
    options: zodResponse(bearerScope("read"), ClusterAgentListResponse, {
      name: "ClusterAgentList",
      description:
        "Every registered cluster-agent with its open-claim count, plus recent offline events",
    }),
    handler: async (_request: Request, h: ResponseToolkit) => {
      const pool = getPool();

      enforceTrue(pool, apiError(503), DB_UNAVAILABLE);

      const body = await handleClusterAgentList({
        agents: new PgClusterAgents(pool),
        runs: new PgAssemblyRuns(pool),
        audit: new PgAudit(pool),
      });

      return h.response(body);
    },
  };
}
