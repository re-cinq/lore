// The stations the external floor dispatches for the spec-tickets line. Each claims its own work from the floor's queue, so starting them is all the wiring there is.
import { defineStation, type RunningStation } from "@re-cinq/floor-station";
import { coverageDeps } from "../planning/coverage-deps.js";
import { issueCoverageHandle } from "./issue-coverage/station.js";
import { startLoadTicketsStation } from "./load-tickets/station.js";
import { startSpecTicketsIssuesStation } from "./file-issues/station.js";
import { startVerifyImplementationStation } from "./verify-implementation/station.js";

export function startSpecTicketsStations(): RunningStation[] {
  return [
    startLoadTicketsStation(),
    startVerifyImplementationStation(),
    startSpecTicketsIssuesStation(),
    // Counts the whole spec: it is given no plan id, which would narrow the count to the statements one plan wrote.
    defineStation("spec-tickets-coverage", issueCoverageHandle(coverageDeps)),
  ];
}
