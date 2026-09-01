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

/**
 * GET /api/agent-definitions/usage — where each catalog entry is actually
 * dispatched from: every blueprint node that resolves to it, inherited or
 * explicit. The catalog is the roster and the blueprints are one consumer, so
 * a definition with no reference here is either a blueprint-less task type
 * (runbook, onboard — dispatched as a single Agent CR by name) or genuinely
 * dormant; which of the two is the CALLER's call, since it knows the
 * definition's execution_mode. Built from the builtin blueprints baked into
 * this image — no database, no per-repo variance (custom per-repo lines are a
 * later concern, and per-repo overrides inherit their base name's usage).
 */

const UsageRefSchema = z.object({
  blueprint: z.string(),
  node_id: z.string(),
  /** True when the station name came from the node's type or its line rather
   *  than an explicit station_ref — the reference that silently changes when a
   *  node is reused on another line. */
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
  /** What each cluster actually did with each definition. Empty without a
   *  database, or before any cluster has reported — an absence of verdicts is
   *  not a claim that everything applied. */
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
      // No database is not a claim that nothing applied — it is the absence of
      // an answer, and the caller renders it as unknown.
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
