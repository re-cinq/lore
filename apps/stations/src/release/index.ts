// The stations the external floor dispatches for the release line. Each claims its own work from the floor's queue, so starting them is all the wiring there is.
import type { RunningStation } from "@re-cinq/floor-station";
import { startReleaseAnnounceStation } from "./announce/station.js";
import { startReleaseCollectStation } from "./collect/station.js";
import { startReleaseGithubReleaseStation } from "./github-release/station.js";
import { startReleasePublishStation } from "./publish/station.js";
import { startReleaseStoreStation } from "./store/station.js";
import { startReleaseTagStation } from "./tag/station.js";

export function startReleaseStations(): RunningStation[] {
  return [
    startReleaseCollectStation(),
    startReleaseTagStation(),
    startReleasePublishStation(),
    startReleaseGithubReleaseStation(),
    startReleaseStoreStation(),
    startReleaseAnnounceStation(),
  ];
}
