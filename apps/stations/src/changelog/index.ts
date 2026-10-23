// The stations the external floor dispatches for the weekly-changelog line. Each claims its own work from the floor's queue, so starting them is all the wiring there is.
import type { RunningStation } from "@re-cinq/floor-station";
import { startChangelogCollectStation } from "./collect/station.js";
import { startChangelogStoreStation } from "./store/station.js";

export function startChangelogStations(): RunningStation[] {
  return [startChangelogCollectStation(), startChangelogStoreStation()];
}
