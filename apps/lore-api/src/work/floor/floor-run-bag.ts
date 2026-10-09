// A run's bag as the external floor holds it now (run-viz FR4.4n): every item the line has put there, by name. The floor keeps no history of it, so this is the bag at the moment of the read.
import type { FloorClient, Item } from "@re-cinq/floor-client";

export type BagFloor = Pick<FloorClient, "runs">;

export type RunBag = Record<string, Item>;

/** Null for a run the floor does not have. */
export async function runBag(
  floor: BagFloor,
  runId: string,
): Promise<RunBag | null> {
  const found = await floor.runs.get(runId);

  return found?.bag ?? null;
}
