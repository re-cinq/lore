// Which agent definitions the shipped floor pipeline files run: each agent station names its agent_definition, and each line node names its station.

import { z } from "zod";
import { parse } from "yaml";
import type { PipelineText } from "../floor/seed-floor-pipelines.js";

export interface StationUsageRef {
  blueprint: string;
  nodeId: string;
  inherited: boolean;
}

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

/** Which agent definition each agent station runs, keyed by station id; a service station names none. */
export function stationDefinitions(files: PipelineText[]): Map<string, string> {
  return new Map(
    files.flatMap((file) =>
      Object.entries(PipelineUsageFile.parse(parse(file.text)).stations ?? {})
        .filter(([, station]) => station.agent_definition !== undefined)
        .map(([id, station]) => [id, station.agent_definition ?? ""]),
    ),
  );
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
