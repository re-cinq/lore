// The stations the external floor dispatches for the issue-triage line.
import type { RunningStation } from "@re-cinq/floor-station";
import { startCloseIssueStation } from "./close-issue/index.js";
import { startTriageLabelStation } from "./triage-label/index.js";
import { startTriageFileIssuesStation } from "./file-issues/station.js";
import { startLoadImplementationStation } from "./implementation/load.js";
import { startVerifyIssueImplementationStation } from "./implementation/verify.js";

export function startIssueTriageStations(): RunningStation[] {
  return [
    startLoadImplementationStation(),
    startVerifyIssueImplementationStation(),
    startCloseIssueStation(),
    startTriageLabelStation(),
    startTriageFileIssuesStation(),
  ];
}
