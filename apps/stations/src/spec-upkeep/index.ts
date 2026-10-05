// The stations the external floor dispatches for the spec-upkeep line. Each claims its own work from the floor's queue, so starting them is all the wiring there is.
import type { RunningStation } from "@re-cinq/floor-station";
import { startRequestReviewStation } from "../onboard/request-review/station.js";
import { startDetectDriftStation } from "./detect-drift/station.js";
import { startDetectUnlinkedStation } from "./detect-unlinked/station.js";
import { startOpenUpkeepPrStation } from "./open-pr/station.js";

export function startSpecUpkeepStations(): RunningStation[] {
  return [
    startDetectDriftStation(),
    startDetectUnlinkedStation(),
    startOpenUpkeepPrStation(),
    startRequestReviewStation("spec-upkeep-request-review"),
  ];
}
