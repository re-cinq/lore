// A visit's records read as what the run page draws: its turns as the agent events the live relay also sends (same ids, so a cursor means the same on both paths), and its log as the lines a node's log panel shows.
import type { StationRunRecordView, VisitView } from "@re-cinq/floor-client";
import type { AgentRunEventInsert } from "@re-cinq/lore-shared/project/agent-run-events/agent-run-events-port.js";
import type { AgentRunEvent } from "@re-cinq/lore-shared/models/agent-run-event.js";
import { rowsFromEnvelope } from "@re-cinq/lore-shared/agent-stream/agent-run-events.js";
import {
  AGENT_CR_PREFIX,
  FAILED_OUTCOMES,
  agentCrNameOf,
  agentEventId,
} from "./floor-run-mapping.js";

const TURN_KIND = "turn";
const DEFAULT_LOG_TAIL = 500;
const RUNNING = "Running";

/** Where a record was made: the visit and the run it belongs to, as both a live frame and a listed record name them. */
export interface RecordPlace {
  runId: string;
  visitId: string;
  nodeId: string;
  iteration: number;
}

/** The node-logs answer the run page reads for a Lore pod, here filled from the floor's own log records of the visit. */
export interface FloorNodeLogs {
  available: boolean;
  logs: string | null;
  phase: string;
  podName: null;
  archived: true;
  reason?: "no-records";
}

/** One turn is one stream-json line, which may project to several rows: a tool call and its text. Each gets the seq and its place in the line, so ids stay numeric, ordered and unique; the live relay and the history read share this so a cursor means the same on both. A record that is not a turn draws nothing. */
export function recordToAgentEvents(
  record: StationRunRecordView,
  place: RecordPlace,
): AgentRunEvent[] {
  const agentCrName = agentCrNameOf(place.visitId);

  return turnRows(record, place.runId, agentCrName).map((row, rowIndex) => ({
    ...ROW_DEFAULTS,
    ...definedOnly(row),
    assemblyLineId: place.runId,
    stationRunId: place.visitId,
    nodeId: place.nodeId,
    iteration: place.iteration,
    createdAt: new Date(record.occurredAt),
    id: agentEventId(record.seq, rowIndex),
    agentCrName,
  }));
}

/** The visit a station run's name stands for, or null for a name Lore's own pods carry. */
export function floorVisitIdOf(agentCrName: string): string | null {
  return agentCrName.startsWith(AGENT_CR_PREFIX)
    ? agentCrName.slice(AGENT_CR_PREFIX.length)
    : null;
}

/** The visit's log records as the lines a log panel shows, newest last and cut to the tail asked for. An open visit with none yet is available and empty, so the panel keeps polling for them; a visit that ended with none is told the floor kept no log rather than shown empty. */
export function nodeLogsOf(
  visit: VisitView,
  records: StationRunRecordView[],
  tail: number | undefined,
): FloorNodeLogs {
  const phase = visitPhaseOf(visit);

  return records.length === 0 && phase !== RUNNING
    ? { ...NO_RECORDS, phase }
    : { ...KEPT, phase, logs: logTextOf(records, tail) };
}

const KEPT = { available: true, podName: null, archived: true } as const;
const NO_RECORDS = {
  ...KEPT,
  available: false,
  logs: null,
  reason: "no-records",
} as const;

function logTextOf(
  records: StationRunRecordView[],
  tail: number | undefined,
): string {
  return records
    .map(logLineOf)
    .slice(-(tail ?? DEFAULT_LOG_TAIL))
    .join("\n");
}

function turnRows(
  record: StationRunRecordView,
  runId: string,
  agentCrName: string,
): AgentRunEventInsert[] {
  return record.kind === TURN_KIND
    ? rowsFromEnvelope({
        source: { task: runId, agent: agentCrName },
        event: record.body,
      })
    : [];
}

/** What a projected row may leave unsaid, as the stored row spells it. */
const ROW_DEFAULTS = {
  toolName: null,
  toolUseId: null,
  isError: false,
  filePaths: [] as string[],
  summary: null,
  payload: {},
};

function definedOnly(row: AgentRunEventInsert) {
  const { carried: _carried, filePaths, ...stated } = row;

  return { ...stated, ...(filePaths ? { filePaths: [...filePaths] } : {}) };
}

// A pod's phases, which the log panel polls on: it keeps reading while the visit is open and stops once it reported.
function visitPhaseOf(visit: VisitView): string {
  if (visit.report === null) {
    return RUNNING;
  }

  return FAILED_OUTCOMES.has(visit.report.outcome) ? "Failed" : "Succeeded";
}

// A log record's body is a small object the floor's runtime wrote (a lifecycle phase, a tool's status); flattened to one line with its time, since the panel shows text.
function logLineOf(record: StationRunRecordView): string {
  const body = record.body;
  const text =
    typeof body === "string"
      ? body
      : Object.entries(body as Record<string, unknown>)
          .map(([key, value]) => `${key}=${String(value)}`)
          .join(" ");

  return `${record.occurredAt} ${text}`;
}
