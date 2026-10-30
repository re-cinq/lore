import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { readFloorPipelineFiles } from "../../../work/floor/seed-floor-pipelines.js";
import {
  usageOfPipelines,
  type StationUsageRef,
} from "../../../work/agents/pipeline-agents.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";

// Where each catalog entry dispatches from: the floor pipeline files name each agent station's agent_definition.

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

// The shipped files change only with the image, so one read serves the process.
let usageOfFiles: Promise<Map<string, StationUsageRef[]>> | undefined;

export function agentDefinitionUsageRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/agent-definitions/usage",
    options: zodResponse(bearerScope("read"), UsageResponse, {
      name: "AgentDefinitionUsage",
      description:
        "Which assembly lines use each stored definition, read from the floor pipeline files",
    }),
    handler: async (_request, h) => {
      usageOfFiles ??= readFloorPipelineFiles().then(usageOfPipelines);

      return h.response(usageResponse(await usageOfFiles));
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
