// The stations the external floor dispatches for the onboard line. Each claims its own work from the floor's queue, so starting them is all the wiring there is.
import type { RunningStation } from "@re-cinq/floor-station";
import { startEnrolStation } from "./enrol/station.js";
import { startOpenOnboardPrStation } from "./open-pr/station.js";
import { startRequestReviewStation } from "./request-review/station.js";

export function startOnboardStations(): RunningStation[] {
  return [
    startEnrolStation(),
    startOpenOnboardPrStation(),
    startRequestReviewStation(),
  ];
}
