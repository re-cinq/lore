// The station the external floor dispatches for the issue-triage line.
import type { RunningStation } from "@re-cinq/floor-station";
import { startCloseIssueStation } from "./close-issue/index.js";

export function startIssueTriageStations(): RunningStation[] {
  return [startCloseIssueStation()];
}
