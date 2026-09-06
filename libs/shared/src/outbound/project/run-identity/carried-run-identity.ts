// Run identity carried by agent events (#1147); wire format is snake_case (#1237).

/** The identity of one node visit, as stated by whoever produced the event. */
export interface CarriedRunIdentity {
  assemblyRunId: string;
  nodeId: string;
  iteration: number;
  /** Null from a producer that knows the visit but not its station-run uuid. */
  stationRunId: string | null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

interface ParsedVisit {
  assemblyRunId: string | null;
  nodeId: string | null;
  iteration: unknown;
}

function isCompleteVisit(
  visit: ParsedVisit,
): visit is { assemblyRunId: string; nodeId: string; iteration: number } {
  const namesTheVisit = visit.assemblyRunId !== null && visit.nodeId !== null;
  const countsTheIteration =
    typeof visit.iteration === "number" && Number.isInteger(visit.iteration);

  return namesTheVisit && countsTheIteration;
}

/** Identity from source; requires all fields present or returns null (all-or-nothing). */
export function parseCarriedRunIdentity(
  source: unknown,
): CarriedRunIdentity | null {
  if (typeof source !== "object" || source === null) {
    return null;
  }

  const fields = source as Record<string, unknown>;
  const visit: ParsedVisit = {
    assemblyRunId: nonEmptyString(fields.assembly_run),
    nodeId: nonEmptyString(fields.node),
    iteration: fields.iteration,
  };

  if (!isCompleteVisit(visit)) {
    return null;
  }

  return {
    assemblyRunId: visit.assemblyRunId,
    nodeId: visit.nodeId,
    iteration: visit.iteration,
    stationRunId: nonEmptyString(fields.station_run),
  };
}
