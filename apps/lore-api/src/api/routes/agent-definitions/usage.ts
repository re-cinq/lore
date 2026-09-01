import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import {
  loadBuiltinAssemblyLines,
  stationUsage,
} from "@re-cinq/lore-assembly-lines";
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

const UsageResponse = z.object({
  usage: z.array(
    z.object({
      name: z.string(),
      used_by: z.array(UsageRefSchema),
    }),
  ),
});

/** The wire shape from the walk's map — sorted so the response is stable. */
export function usageResponse(
  usage: ReadonlyMap<
    string,
    Array<{ blueprint: string; nodeId: string; inherited: boolean }>
  >,
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
  };
}

export function agentDefinitionUsageRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/agent-definitions/usage",
    options: zodResponse(bearerScope("read"), UsageResponse, {
      name: "AgentDefinitionUsage",
      description:
        "Every station name a builtin blueprint node dispatches, with the nodes that reference it",
    }),
    handler: async (_request, h) => {
      return h.response(
        usageResponse(stationUsage(await loadBuiltinAssemblyLines())),
      );
    },
  };
}
