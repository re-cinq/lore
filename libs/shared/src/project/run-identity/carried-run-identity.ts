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

/** Identity from source; requires all fields present or returns null (all-or-nothing). */
export function parseCarriedRunIdentity(
  source: unknown,
): CarriedRunIdentity | null {
  if (typeof source !== "object" || source === null) {
    return null;
  }

  const fields = source as Record<string, unknown>;
  const assemblyRunId = nonEmptyString(fields.assembly_run);
  const nodeId = nonEmptyString(fields.node);
  const iteration = fields.iteration;
  const namesTheVisit = assemblyRunId !== null && nodeId !== null;
  const countsTheIteration =
    typeof iteration === "number" && Number.isInteger(iteration);

  if (!namesTheVisit || !countsTheIteration) {
    return null;
  }

  return {
    assemblyRunId,
    nodeId,
    iteration,
    stationRunId: nonEmptyString(fields.station_run),
  };
}
