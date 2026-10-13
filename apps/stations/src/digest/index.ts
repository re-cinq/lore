// The stations the external floor dispatches for the daily-digest line. Each claims its own work from the floor's queue, so starting them is all the wiring there is.
import type { RunningStation } from "@re-cinq/floor-station";
import { startDigestCollectStation } from "./collect/station.js";
import { startDigestPostStation } from "./post/station.js";

export function startDigestStations(): RunningStation[] {
  return [startDigestCollectStation(), startDigestPostStation()];
}
