// The stations the external floor dispatches for the issue-triage line.
import type { RunningStation } from "@re-cinq/floor-station";
import { startCloseIssueStation } from "./close-issue/index.js";
import { startTriageLabelStation } from "./triage-label/index.js";
import { startTriageFileIssuesStation } from "./file-issues/station.js";
import { startReconcileImplementationStation } from "./reconcile-implementation/station.js";

export function startIssueTriageStations(): RunningStation[] {
  return [
    startReconcileImplementationStation(),
    startCloseIssueStation(),
    startTriageLabelStation(),
    startTriageFileIssuesStation(),
  ];
}
