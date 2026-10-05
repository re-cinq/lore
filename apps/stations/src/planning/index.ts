// The stations the external floor dispatches for the feature-planning line. Each claims its own work from the floor's queue, so starting them is all the wiring there is.
import type { RunningStation } from "@re-cinq/floor-station";
import { startPlanPassEndStation } from "./plan-pass-end/station.js";
import { startOpenSpecPrStation } from "./open-spec-pr/station.js";
import { startSpecCoverageStation } from "./spec-coverage/station.js";
import { startFileIssuesStation } from "./file-issues/station.js";
import { startIssueCoverageStation } from "./issue-coverage/station.js";

export function startPlanningStations(): RunningStation[] {
  return [
    startPlanPassEndStation(),
    startSpecCoverageStation(),
    startOpenSpecPrStation(),
    startFileIssuesStation(),
    startIssueCoverageStation(),
  ];
}
