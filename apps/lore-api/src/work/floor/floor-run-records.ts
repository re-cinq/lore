// The records a visit keeps on the floor, read to the end: a run's turns in the order the walk opened its visits, and one visit's log.
import type {
  FloorClient,
  RecordKind,
  StationRunRecordView,
  VisitView,
} from "@re-cinq/floor-client";
import type { AgentRunTurnRow } from "@re-cinq/lore-shared/project/agent-run-turns/agent-run-turns-port.js";
import { turnRecordToRow } from "./floor-run-mapping.js";
import {
  floorVisitIdOf,
  nodeLogsOf,
  type FloorNodeLogs,
} from "./floor-records.js";

type StationRuns = Pick<FloorClient["stationRuns"], "list" | "get" | "records">;

const RECORDS_PER_READ = 1000;

/** Every turn of the run, visit by visit in the order the walk opened them. The floor numbers turns within a visit, so a row's id here is its place in the run: the cursor a reader pages with. */
export async function runTurns(
  stationRuns: StationRuns,
  runId: string,
): Promise<AgentRunTurnRow[]> {
  const visits = await stationRuns.list({ run: runId });
  const perVisit = await Promise.all(
    visits.map((visit) => turnsOf(stationRuns, visit)),
  );

  return perVisit
    .flat()
    .map((turn, place) => ({ ...turn, id: String(place + 1) }));
}

/** The log the floor kept for one of the run's visits, named as the run page names it (`floor-<visit id>`); null for a name of no visit of this run. */
export async function runNodeLogs(
  stationRuns: StationRuns,
  runId: string,
  agentCrName: string,
  tail: number | undefined,
): Promise<FloorNodeLogs | null> {
  const visitId = floorVisitIdOf(agentCrName);
  const visit = visitId ? await stationRuns.get(visitId) : null;

  if (!visit || visit.runId !== runId) {
    return null;
  }

  return nodeLogsOf(visit, await recordsOf(stationRuns, visit, "log"), tail);
}

async function turnsOf(
  stationRuns: StationRuns,
  visit: VisitView,
): Promise<AgentRunTurnRow[]> {
  const turns = await recordsOf(stationRuns, visit, "turn");

  return turns.map((turn) => turnRecordToRow(turn, visit));
}

/** Every record of one kind the visit has, read to the end. */
export async function recordsOf(
  stationRuns: StationRuns,
  visit: VisitView,
  kind: RecordKind,
): Promise<StationRunRecordView[]> {
  const records: StationRunRecordView[] = [];
  let since: number | null = 0;

  while (since !== null) {
    const page = await stationRuns.records(visit.id, {
      kind,
      since,
      limit: RECORDS_PER_READ,
    });

    records.push(...page.items);
    since = page.nextCursor;
  }

  return records;
}
