import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import {
  loadBuiltinAssemblyLines,
  stationUsage,
} from "@re-cinq/lore-assembly-lines";
import type { Pool } from "pg";
import { PgCatalogStatus } from "@re-cinq/lore-shared/project/agents/catalog-status-pg.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";

// Where each catalog entry dispatches from; a definition with no reference here is either blueprint-less (runbook/onboard) or dormant — the caller decides which.

const UsageRefSchema = z.object({
  blueprint: z.string(),
  node_id: z.string(),
  // True when the station name came from the node's type/line, not an explicit station_ref — can silently change if the node is reused.
  inherited: z.boolean(),
});

const ApplyStatusSchema = z.object({
  name: z.string(),
  project_id: z.string().nullable(),
  cluster: z.string(),
  state: z.enum(["applied", "refused", "skipped", "deleted"]),
  reason: z.string().nullable(),
});

const UsageResponse = z.object({
  usage: z.array(
    z.object({
      name: z.string(),
      used_by: z.array(UsageRefSchema),
    }),
  ),
  // What each cluster did with each definition; empty (no db, or nothing reported yet) is not a claim everything applied.
  applied: z.array(ApplyStatusSchema),
});

interface StationUsageRef {
  blueprint: string;
  nodeId: string;
  inherited: boolean;
}

/** One catalog entry with the blueprint nodes that dispatch it. */
function usageEntry(name: string, refs: StationUsageRef[]) {
  return {
    name,
    used_by: refs.map((ref) => ({
      blueprint: ref.blueprint,
      node_id: ref.nodeId,
      inherited: ref.inherited,
    })),
  };
}

/** The wire shape from the walk's map — sorted so the response is stable. */
export function usageResponse(
  usage: ReadonlyMap<string, StationUsageRef[]>,
  applied: z.infer<typeof UsageResponse>["applied"] = [],
): z.infer<typeof UsageResponse> {
  return {
    usage: [...usage]
      .map(([name, refs]) => usageEntry(name, refs))
      .sort((a, b) => a.name.localeCompare(b.name)),
    applied,
  };
}

/** What each cluster did with each definition; no database is not a claim that nothing applied — it is an absence the caller renders as unknown. */
async function appliedStatuses(
  pool: Pool | null,
): Promise<z.infer<typeof UsageResponse>["applied"]> {
  if (!pool) {
    return [];
  }

  const statuses = await new PgCatalogStatus(pool).list();

  return statuses.map((s) => ({
    name: s.name,
    project_id: s.projectId,
    cluster: s.clusterName,
    state: s.state,
    reason: s.reason,
  }));
}

export function agentDefinitionUsageRoute(
  getPool: () => Pool | null = () => null,
): ServerRoute {
  return {
    method: "GET",
    path: "/api/agent-definitions/usage",
    options: zodResponse(bearerScope("read"), UsageResponse, {
      name: "AgentDefinitionUsage",
      description:
        "Every station name a builtin blueprint node dispatches, with the nodes that reference it",
    }),
    handler: async (_request, h) => {
      const applied = await appliedStatuses(getPool());
      const lines = await loadBuiltinAssemblyLines();

      return h.response(usageResponse(stationUsage(lines), applied));
    },
  };
}
