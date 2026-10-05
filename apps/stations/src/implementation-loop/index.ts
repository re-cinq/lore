// The stations the external floor dispatches for the implementation-loop line. Each claims its own work from the floor's queue, so starting them is all the wiring there is.
import type { RunningStation } from "@re-cinq/floor-station";
import { startMarkReadyStation } from "./mark-ready/station.js";
import { startOpenLoopPrStation } from "./open-pr/station.js";

export function startImplementationLoopStations(): RunningStation[] {
  return [startOpenLoopPrStation(), startMarkReadyStation()];
}
