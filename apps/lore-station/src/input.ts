// The station contract's input: the Floor renders the station AgentDefinition's
// `{station_input}` prompt template from Agent.spec.parameters.station_input and
// the exec vendor appends it as the process's final argv. Producer:
// apps/floor nodeStationSpec; contract: specs/6-dark-factory/contracts/station-contract.md.

import { z } from "zod";

const StationInputSchema = z.object({
  assembly_line_id: z.string().min(1),
  node_id: z.string().min(1),
  node_type: z.string().min(1),
  repo: z.string().min(1),
  branch: z.string().min(1),
  /** Null for task-less runs (detection assembly lines). */
  task_id: z.string().nullable(),
  params: z.record(z.string()).default({}),
});

export type StationInput = z.infer<typeof StationInputSchema>;

export function parseStationInput(json: string): StationInput {
  return StationInputSchema.parse(JSON.parse(json));
}
