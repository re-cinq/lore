// Station input contract, owned in ONE place (#1231): Floor writes via serializeStationInput, lore-station reads via parseStationInput, so a key on only one side is a compile error, not a broken deploy (mid-rename dual-key support for assembly_run_id/assembly_line_id, specs/6-dark-factory FR6.41/FR6.45 — delete the legacy key once no old image is deployed; contract: specs/6-dark-factory/contracts/station-contract.md).

import { z } from "zod";

export const StationInputSchema = z.object({
  assembly_run_id: z.string().min(1),
  node_id: z.string().min(1),
  node_type: z.string().min(1),
  repo: z.string().min(1),
  branch: z.string().min(1),
  /** Null for task-less runs (detection assembly lines). */
  task_id: z.string().nullable(),
  params: z.record(z.string()).default({}),
});

export type StationInput = z.infer<typeof StationInputSchema>;

/** The wire shape: either run-id spelling satisfies it, new key winning. */
const StationInputWireSchema = StationInputSchema.extend({
  assembly_run_id: z.string().min(1).optional(),
  assembly_line_id: z.string().min(1).optional(),
}).refine((wire) => wire.assembly_run_id ?? wire.assembly_line_id, {
  message: "station_input carries neither assembly_run_id nor assembly_line_id",
});

/** Reads the input a pod was launched with; throws on any contract mismatch — a malformed brief silently doing the wrong work is worse than not starting. */
export function parseStationInput(json: string): StationInput {
  const wire = StationInputWireSchema.parse(JSON.parse(json));
  const { assembly_line_id: legacyRunId, ...rest } = wire;

  return {
    ...rest,
    assembly_run_id: (wire.assembly_run_id ?? legacyRunId) as string,
  };
}

/** Writes the input for one station pod — the producer's ONLY way to spell it; validates on the way out too, so an empty field surfaces at dispatch, not inside a pod's logs. */
export function serializeStationInput(input: StationInput): string {
  const valid = StationInputSchema.parse(input);

  return JSON.stringify({
    ...valid,
    // Legacy spelling rides along for exactly one release — a prior-release lore-station image still requires it.
    assembly_line_id: valid.assembly_run_id,
  });
}
