// One frame of the floor's live socket, as the frames the run page already reads. A visit's frame carries its agent's settings, prompt included; the mapping copies by whitelist, so none of it reaches a browser.
import type { LiveFrame } from "@re-cinq/floor-client";
import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
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
import { recordToAgentEvents } from "./floor-records.js";

type RecordFrame = Extract<LiveFrame, { type: "record" }>;
type VisitFrame = Extract<LiveFrame, { visit: unknown }>;
type SettledFrame = Extract<LiveFrame, { type: "run_settled" }>;
type CaughtUpFrame = Extract<LiveFrame, { type: "caught_up" }>;
type Translate = (frame: LiveFrame, run: AssemblyRunRecord) => RunStreamFrame[];

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

/** A frame type this build has no translation for is passed over, not thrown on: the floor's journal gains types on its own release train (`run_reopened` arrived in floor v0.1.9, which floor-client 0.1.6 does not declare), and a throw here takes down the viewer's whole feed — which the browser answers by reconnecting, replaying and throwing again. specs/external-floor FR18. */
export function floorFrames(
  frame: LiveFrame,
  run: AssemblyRunRecord,
): RunStreamFrame[] {
  const translate = TRANSLATIONS[frame.type] as Translate | undefined;

  return translate ? translate(frame, run) : [];
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
  });

  return [runStatusFrame(settled)];
}

function agentEventFrames(
  frame: RecordFrame,
  run: AssemblyRunRecord,
): RunStreamFrame[] {
  return recordToAgentEvents(frame.record, {
    runId: run.id,
    visitId: frame.visitId,
    nodeId: frame.nodeId,
    iteration: frame.iteration,
    seq: frame.seq,
  }).map(agentEventFrame);
}
