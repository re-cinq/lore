// The stations the external floor dispatches for the feature-planning line. Each claims its own work from the floor's queue, so starting them is all the wiring there is.
import type { RunningStation } from "@re-cinq/floor-station";
import { startPlanPassEndStation } from "./plan-pass-end/station.js";
import { startPlanFindingsStation } from "./plan-findings/station.js";
import { startPlanGroundingStation } from "./plan-grounding/station.js";
import { startOpenSpecPrStation } from "./open-spec-pr/station.js";
import { startAssembleStation } from "./assemble/station.js";
import { startSpecFindingsStation } from "./spec-findings/station.js";
import { startSplitSectionsStation } from "./split-sections/station.js";
import { startQaQuestionsStation } from "./qa-questions/station.js";
import { startQaGateStation } from "./qa-gate/station.js";
import { startFileIssuesStation } from "./file-issues/station.js";
import { startIssueCoverageStation } from "./issue-coverage/station.js";

export function startPlanningStations(): RunningStation[] {
  return [
    startPlanPassEndStation(),
    startPlanFindingsStation(),
    startPlanGroundingStation(),
    startSpecFindingsStation(),
    startSplitSectionsStation(),
    startAssembleStation(),
    startQaQuestionsStation(),
    startQaGateStation(),
    startOpenSpecPrStation(),
    startFileIssuesStation(),
    startIssueCoverageStation(),
  ];
}
