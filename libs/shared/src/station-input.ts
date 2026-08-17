// The station contract's input, owned in ONE place (#1231).
//
// The Floor renders a station AgentDefinition's `{station_input}` template from
// `Agent.spec.parameters.station_input`, and the exec vendor appends it as the
// pod process's final argv. So this JSON is a contract between two separately
// built and deployed images: `apps/floor` writes it, `apps/lore-station` reads it.
//
// It used to be declared twice — an object literal on the producer, a zod schema
// on the consumer — with nothing tying them together. That is not a theoretical
// risk: during the AssemblyRun rename a sweep rewrote `assembly_line_id` on the
// Floor's side and left the station's parser untouched, which would have failed
// every station run. It was caught by luck, because an unrelated test happened to
// assert the payload's shape.
//
// So the fix is not another test — it is removing the second declaration. The
// producer writes through `serializeStationInput`, the consumer reads through
// `parseStationInput`, and a key that exists on only one side is a compile error
// rather than a broken deploy.
//
// Field names are the CONTRACT and are deliberately snake_case: they cross a
// process boundary into a pod, and `assembly_line_id` in particular keeps its
// pre-rename spelling until both images can move together (specs/6-dark-factory
// FR6.41 — readers-first). Renaming anything here means shipping both sides and
// the contract doc in one change.
//
// Contract: specs/6-dark-factory/contracts/station-contract.md

import { z } from "zod";

export const StationInputSchema = z.object({
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

/**
 * Read the input a pod was launched with. Throws on anything that does not match
 * the contract — a station that ran with a malformed brief would do the wrong
 * work silently, which is worse than not starting.
 */
export function parseStationInput(json: string): StationInput {
  return StationInputSchema.parse(JSON.parse(json));
}

/**
 * Write the input for one station pod — the producer's ONLY way to spell it.
 *
 * Validates on the way out as well as on the way in. The Floor builds this from
 * its own row and graph, so a field that is empty here is a Floor bug, and the
 * useful moment to learn that is at dispatch rather than inside a pod whose logs
 * someone has to go find.
 */
export function serializeStationInput(input: StationInput): string {
  return JSON.stringify(StationInputSchema.parse(input));
}
