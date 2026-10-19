// The stations the external floor dispatches for the code-review lines. Each claims its own work from the floor's queue, so starting them is all the wiring there is.
import type { RunningStation } from "@re-cinq/floor-station";
import { startPostReplyStation } from "./post-reply/station.js";
import { startPostReviewStation } from "./post-review/station.js";
import { startReadReviewStation } from "./read-review/station.js";
import { startRunSettledStation } from "./run-settled/station.js";

export function startCodeReviewStations(): RunningStation[] {
  return [
    startPostReviewStation(),
    startReadReviewStation(),
    startPostReplyStation(),
    startRunSettledStation(),
  ];
}
