import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import {
  loadBuiltinAssemblyLines,
  stationUsage,
} from "@re-cinq/lore-assembly-lines";
import type { Pool } from "pg";
import { PgCatalogStatus } from "@re-cinq/lore-shared/project/agents/catalog-status-pg.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";

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

/** The wire shape from the walk's map — sorted so the response is stable. */
export function usageResponse(
  usage: ReadonlyMap<
    string,
    Array<{ blueprint: string; nodeId: string; inherited: boolean }>
  >,
  applied: z.infer<typeof UsageResponse>["applied"] = [],
): z.infer<typeof UsageResponse> {
  return {
    usage: [...usage]
      .map(([name, refs]) => ({
        name,
        used_by: refs.map((ref) => ({
          blueprint: ref.blueprint,
          node_id: ref.nodeId,
          inherited: ref.inherited,
        })),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    applied,
  };
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
      const pool = getPool();
      // No database is not a claim that nothing applied — it is an absence the caller renders as unknown.
      const applied = pool
        ? (await new PgCatalogStatus(pool).list()).map((s) => ({
            name: s.name,
            project_id: s.projectId,
            cluster: s.clusterName,
            state: s.state,
            reason: s.reason,
          }))
        : [];

      return h.response(
        usageResponse(stationUsage(await loadBuiltinAssemblyLines()), applied),
      );
    },
  };
}
