// The stations the external floor dispatches for the release line. Each claims its own work from the floor's queue, so starting them is all the wiring there is.
import type { RunningStation } from "@re-cinq/floor-station";
import { startReleaseCollectStation } from "./collect/station.js";
import { startReleaseTagStation } from "./tag/station.js";

export function startReleaseStations(): RunningStation[] {
  return [startReleaseCollectStation(), startReleaseTagStation()];
}
