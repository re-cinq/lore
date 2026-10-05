import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";

// Where each catalog entry dispatches from; a definition with no reference here is either blueprint-less (runbook/onboard) or dormant — the caller decides which.

const UsageRefSchema = z.object({
  blueprint: z.string(),
  node_id: z.string(),
  // True when the station name came from the node's type/line, not an explicit station_ref — can silently change if the node is reused.
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

interface StationUsageRef {
  blueprint: string;
  nodeId: string;
  inherited: boolean;
}

export function agentDefinitionUsageRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/agent-definitions/usage",
    options: zodResponse(bearerScope("read"), UsageResponse, {
      name: "AgentDefinitionUsage",
      description:
        "Which lines use each stored definition (none: a floor pipeline carries its agents inline)",
    }),
    handler: (_request, h) => {
      // No line names a stored definition: a floor pipeline file carries its agents inline.
      return h.response(usageResponse(new Map()));
    },
  };
}

/** The wire shape from the walk's map — sorted so the response is stable. */
export function usageResponse(
  usage: ReadonlyMap<string, StationUsageRef[]>,
): z.infer<typeof UsageResponse> {
  return {
    usage: [...usage]
      .map(([name, refs]) => usageEntry(name, refs))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
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
