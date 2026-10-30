import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { parse } from "yaml";
import {
  readFloorPipelineFiles,
  type PipelineText,
} from "../../../work/floor/seed-floor-pipelines.js";
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

interface StationUsageRef {
  blueprint: string;
  nodeId: string;
  inherited: boolean;
}

// The shipped files change only with the image, so one read serves the process.
let usageOfFiles: Promise<Map<string, StationUsageRef[]>> | undefined;

const PipelineUsageFile = z.object({
  line: z
    .object({
      id: z.string(),
      nodes: z.array(
        z.object({ id: z.string(), station: z.string().optional() }),
      ),
    })
    .optional(),
  stations: z
    .record(z.string(), z.object({ agent_definition: z.string().optional() }))
    .optional(),
});

/** Every agent definition a line's node dispatches, through the node's station, keyed by definition name. */
export function usageOfPipelines(
  files: PipelineText[],
): Map<string, StationUsageRef[]> {
  const usage = new Map<string, StationUsageRef[]>();

  files
    .flatMap((file) => pipelineRefs(file.text))
    .forEach(([name, ref]) =>
      usage.set(name, [...(usage.get(name) ?? []), ref]),
    );

  return usage;
}

function pipelineRefs(text: string): Array<[string, StationUsageRef]> {
  const { line, stations } = PipelineUsageFile.parse(parse(text));
  const stationsByName = new Map(Object.entries(stations ?? {}));

  if (line === undefined) {
    return [];
  }

  return line.nodes.flatMap((node) => {
    const definition = stationsByName.get(node.station ?? "")?.agent_definition;

    return definition === undefined
      ? []
      : [
          [
            definition,
            { blueprint: line.id, nodeId: node.id, inherited: true },
          ],
        ];
  });
}

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
