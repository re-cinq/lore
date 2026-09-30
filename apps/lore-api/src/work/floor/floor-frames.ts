// One frame of the floor's live socket, as the frames the run page already reads. A visit's frame carries its agent's settings, prompt included; the mapping copies by whitelist, so none of it reaches a browser.
import type { LiveFrame } from "@re-cinq/floor-client";
import type { AgentRunEventInsert } from "@re-cinq/lore-shared/project/agent-run-events/agent-run-events-port.js";
import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { AgentRunEvent } from "@re-cinq/lore-shared/models/agent-run-event.js";
import { rowsFromEnvelope } from "@re-cinq/lore-shared/agent-stream/agent-run-events.js";
import {
  agentEventFrame,
  catchupFrame,
  nodeStatusFrame,
  runStatusFrame,
  type RunStreamFrame,
} from "../assembly-line-station/run-stream-frame.js";
import {
  agentEventId,
  floorRunToAssemblyRun,
  visitToStationRun,
} from "./floor-run-mapping.js";

type RecordFrame = Extract<LiveFrame, { type: "record" }>;
type VisitFrame = Extract<LiveFrame, { visit: unknown }>;
type SettledFrame = Extract<LiveFrame, { type: "run_settled" }>;
type CaughtUpFrame = Extract<LiveFrame, { type: "caught_up" }>;
type Translate = (frame: LiveFrame, run: AssemblyRunRecord) => RunStreamFrame[];

const TURN_KIND = "turn";

const TRANSLATIONS: Record<
  LiveFrame["type"],
  (frame: never, run: AssemblyRunRecord) => RunStreamFrame[]
> = {
  record: agentEventFrames,
  visit_opened: visitFrames,
  visit_reported: visitFrames,
  run_settled: settledFrames,
  caught_up: (frame: CaughtUpFrame) => [
    catchupFrame(agentEventId(frame.seq, 0)),
  ],
  unsupported: () => [],
};

export function floorFrames(
  frame: LiveFrame,
  run: AssemblyRunRecord,
): RunStreamFrame[] {
  return (TRANSLATIONS[frame.type] as Translate)(frame, run);
}

function visitFrames(
  frame: VisitFrame,
  run: AssemblyRunRecord,
): RunStreamFrame[] {
  return [nodeStatusFrame(visitToStationRun(frame.visit, run))];
}

function settledFrames(
  frame: SettledFrame,
  run: AssemblyRunRecord,
): RunStreamFrame[] {
  const settled = floorRunToAssemblyRun({
    run: frame.run,
    visits: [],
    graph: run.graph!,
    createdAt: run.createdAt,
  });

  return [runStatusFrame(settled)];
}

/** One turn is one stream-json line, which may project to several rows: a tool call and its text. Each gets the seq and its place in the line, so ids stay numeric, ordered and unique. */
function agentEventFrames(
  frame: RecordFrame,
  run: AssemblyRunRecord,
): RunStreamFrame[] {
  const agentCrName = `floor-${frame.visitId}`;

  return turnRows(frame, run.id, agentCrName).map((row, rowIndex) =>
    agentEventFrame({
      ...ROW_DEFAULTS,
      ...definedOnly(row),
      ...placeOf(frame, run),
      id: agentEventId(frame.seq, rowIndex),
      agentCrName,
    }),
  );
}

/** Only a turn is drawn: logs, costs and produced files are the floor's own records. */
function turnRows(
  frame: RecordFrame,
  runId: string,
  agentCrName: string,
): AgentRunEventInsert[] {
  return frame.record.kind === TURN_KIND
    ? rowsFromEnvelope({
        source: { task: runId, agent: agentCrName },
        event: frame.record.body,
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

function placeOf(
  frame: RecordFrame,
  run: AssemblyRunRecord,
): Pick<
  AgentRunEvent,
  "assemblyLineId" | "stationRunId" | "nodeId" | "iteration" | "createdAt"
> {
  return {
    assemblyLineId: run.id,
    stationRunId: frame.visitId,
    nodeId: frame.nodeId,
    iteration: frame.iteration,
    createdAt: new Date(frame.record.occurredAt),
  };
}
