import { startValue } from "@re-cinq/lore-shared/review/floor-review-runs.js";
import type {
  Item,
  LineBody,
  LineNode,
  RunView,
  StationRunRecordView,
  VisitView,
} from "@re-cinq/floor-client";
import type {
  AssemblyRunRecord,
  AssemblyRunSummary,
  StationRunRecord,
} from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type {
  RunGraph,
  RunGraphNode,
} from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import { resolveRoute } from "./route-template.js";
import type { AgentRunTurnRow } from "@re-cinq/lore-shared/project/agent-run-turns/agent-run-turns-port.js";

/** A station's kind as the floor names it, with the human station that produces something told apart: there a person writes what the line runs on, where a plain human station waits on something outside it. */
export type StationKindName = "agent" | "service" | "human" | "author";

const NODE_TYPE_BY_STATION_KIND: Record<StationKindName, string> = {
  agent: "agent",
  service: "validate",
  human: "pr_review",
  author: "feature_review",
};
const HUMAN_NODE_TYPES: ReadonlySet<string> = new Set([
  "pr_review",
  "feature_review",
]);
const MARKER_NODE_TYPE = "retrospective";
const GITHUB_PREFIX = /^github\.com\//;
const PULL_REQUEST_URL = /\/pull\/(\d+)$/;
const MILLIS_PER_MINUTE = 60_000;
const EVENT_ID_ROW_SPAN = 100;

/** A line as the floor sends it. floor-client 0.1.6 does not type `fail` yet; the floor sends it for a line that has one. */
export type FloorLineBody = LineBody & { fail?: string };

export const AGENT_CR_PREFIX = "floor-";
export const FAILED_OUTCOMES = new Set(["error", "failed", "cancelled"]);

export function lineBodyToRunGraph(
  lineId: string,
  body: FloorLineBody,
  stationKinds: Record<string, StationKindName>,
): RunGraph {
  return {
    name: lineId,
    entry: body.entry,
    exit: body.exit,
    fail: body.fail,
    nodes: body.nodes.map((node) => graphNodeOf(node, stationKinds)),
    edges: body.edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      on: edge.on,
      iteration_max: edge.iterationMax,
    })),
  };
}

export function floorRunToAssemblyRun(input: {
  run: RunView;
  visits: VisitView[];
  graph: RunGraph;
}): AssemblyRunRecord {
  const { run, visits, graph } = input;

  return { ...floorRunToSummary({ run, visits }), graph };
}

export function floorRunToSummary(input: {
  run: RunView;
  visits: VisitView[];
}): AssemblyRunSummary {
  const { run, visits } = input;
  const createdAt = new Date(run.createdAt);

  return {
    ...runIdentityOf(run),
    status: runStatusOf(run, visits),
    resumedFromRunId: null,
    resumedFromNodeId: null,
    inheritedNodeCount: 0,
    createdAt,
    startedAt: createdAt,
    finishedAt: run.finishedAt ? new Date(run.finishedAt) : null,
  };
}

/** The run a visit is read against: its graph when the caller holds one, which is what tells a visit waiting on a person from one a pod runs. */
export interface VisitRun {
  id: string;
  repo: string;
  graph?: Pick<RunGraph, "nodes"> | null;
  /** The run's args, which a human station's route template may name. */
  args?: Record<string, unknown>;
  /** nodeId → the route template its station declares, for a human station. */
  routes?: Record<string, string>;
}

export function visitToStationRun(
  visit: VisitView,
  run: VisitRun,
): StationRunRecord {
  const claimedAt = claimedAtOf(visit);

  return {
    ...visitIdentityOf(visit),
    ...podNameOf(visit, run),
    status: stationRunStatusOf(visit),
    clusterAgentId: visit.worker,
    requiredTags: visit.agentSettings?.tags ?? [],
    claimedAt,
    ...visitVerdictOf(visit),
    ...visitBagOf(visit, run),
    commitSha: null,
    requestedBy: visit.requestedBy,
    startedAt: new Date(visit.openedAt),
    finishedAt: visit.finishedAt ? new Date(visit.finishedAt) : null,
  };
}

export function turnRecordToRow(
  record: StationRunRecordView,
  visit: { id: string; runId: string; nodeId: string; iteration: number },
): AgentRunTurnRow {
  return {
    id: String(record.seq),
    taskId: null,
    agentCrName: agentCrNameOf(visit.id),
    assemblyLineId: visit.runId,
    stationRunId: visit.id,
    nodeId: visit.nodeId,
    iteration: visit.iteration,
    eventType: eventTypeOf(record.body),
    envelope: { source: {}, event: record.body },
    createdAt: new Date(record.occurredAt),
  };
}

export function agentEventId(seq: number, rowIndex: number): string {
  return String(seq * EVENT_ID_ROW_SPAN + rowIndex);
}

export function floorCursorOf(after: string | undefined): number | undefined {
  if (after === undefined || after === "0") {
    return undefined;
  }

  return Math.floor(Number(after) / EVENT_ID_ROW_SPAN);
}

function graphNodeOf(
  node: LineNode,
  stationKinds: Record<string, StationKindName>,
): RunGraphNode {
  const placement = nodePlacementOf(node.station, stationKinds);

  return { id: node.id, ...placement, station_inherited: false };
}

function nodePlacementOf(
  station: string | undefined,
  stationKinds: Record<string, StationKindName>,
): Pick<RunGraphNode, "type" | "station"> {
  if (station === undefined) {
    return { type: MARKER_NODE_TYPE, station: null };
  }
  const name = stationNameOf(station);
  const kind = stationKinds[name] ?? "agent";

  return {
    type: NODE_TYPE_BY_STATION_KIND[kind],
    station: HUMAN_NODE_TYPES.has(NODE_TYPE_BY_STATION_KIND[kind])
      ? null
      : name,
  };
}

function stationNameOf(station: string): string {
  return station.split("@")[0];
}

type RunIdentity = Omit<
  AssemblyRunRecord,
  | "status"
  | "graph"
  | "resumedFromRunId"
  | "resumedFromNodeId"
  | "inheritedNodeCount"
  | "createdAt"
  | "startedAt"
  | "finishedAt"
>;

function runIdentityOf(run: RunView): RunIdentity {
  return {
    id: run.id,
    blueprintName: run.lineId,
    // A line that keeps a `pipeline.tasks` row is started with it as `task_id`.
    taskId: startValue(run, "task_id") ?? null,
    repo: (run.repo ?? "").replace(GITHUB_PREFIX, ""),
    branch: branchOf(run.startItems),
    subjectKey: run.subjectKey,
    args: runArgsOf(run.startItems),
    outcome: run.outcome,
    reason: run.reason,
    blueprintHash: run.lineHash,
  };
}

function branchOf(startItems: Record<string, Item>): string | null {
  const gitRef = Object.values(startItems).find(
    (startItem) => startItem.kind === "git",
  )?.ref;

  return gitRef?.split("@")[1] ?? null;
}

function runArgsOf(startItems: Record<string, Item>): Record<string, unknown> {
  const args: Record<string, unknown> = { engine: "floor" };

  for (const [name, startItem] of Object.entries(startItems)) {
    if (startItem.kind === "value") {
      args[name] = startItem.ref;
    }
  }
  const pullNumber = Object.values(args)
    .map((value) => PULL_REQUEST_URL.exec(String(value))?.[1])
    .find((digits) => digits !== undefined);

  return pullNumber === undefined
    ? args
    : { ...args, pr_number: Number(pullNumber) };
}

function runStatusOf(
  run: RunView,
  visits: VisitView[],
): AssemblyRunRecord["status"] {
  if (run.finishedAt) {
    return FAILED_OUTCOMES.has(run.outcome ?? "") ? "failed" : "finished";
  }

  return visits.length > 0 ? "running" : "queued";
}

// A visit of a human station has no pod behind it, so it carries no pod name: the page offers logs and a "running" pod only for a name.
function podNameOf(
  visit: VisitView,
  run: VisitRun,
): Pick<StationRunRecord, "agentCrName"> {
  const nodes = run.graph?.nodes ?? [];
  const node = nodes.find((known) => known.id === visit.nodeId);
  const onPerson = node !== undefined && HUMAN_NODE_TYPES.has(node.type);

  return { agentCrName: onPerson ? null : agentCrNameOf(visit.id) };
}

function visitIdentityOf(
  visit: VisitView,
): Pick<
  StationRunRecord,
  "id" | "stationRunId" | "assemblyRunId" | "nodeId" | "iteration"
> {
  return {
    id: visit.id,
    stationRunId: visit.id,
    assemblyRunId: visit.runId,
    nodeId: visit.nodeId,
    iteration: visit.iteration,
  };
}

function visitVerdictOf(
  visit: VisitView,
): Pick<StationRunRecord, "outcome" | "failureClass" | "failureDetail"> {
  return {
    outcome: visit.report?.outcome ?? null,
    failureClass: null,
    failureDetail: visit.report?.error ?? null,
  };
}

/** What the visit was started with: the floor's brief holds the bag as the pod saw it, so there is no separate dispatch snapshot to record. */
function visitBagOf(
  visit: VisitView,
  run: VisitRun,
): Pick<StationRunRecord, "input" | "needs" | "produced" | "routeUrl"> {
  return {
    input: null,
    needs: visit.brief.needs,
    produced: visit.report?.produced ?? null,
    routeUrl: routeUrlOf(visit, run),
  };
}

/** A human station's page for this visit, filled from the run's args and the visit's needs (run-viz FR4.1i). */
function routeUrlOf(visit: VisitView, run: VisitRun): string | null {
  const template = run.routes?.[visit.nodeId];

  return template === undefined
    ? null
    : resolveRoute(template, {
        args: run.args ?? {},
        needs: visit.brief.needs,
        repo: run.repo,
      });
}

export function agentCrNameOf(visitId: string): string {
  return `${AGENT_CR_PREFIX}${visitId}`;
}

function claimedAtOf(visit: VisitView): Date | null {
  if (visit.deadline === null) {
    return null;
  }
  const timeoutMinutes = visit.agentSettings?.timeoutMinutes ?? 0;

  return new Date(
    Date.parse(visit.deadline) - timeoutMinutes * MILLIS_PER_MINUTE,
  );
}

function stationRunStatusOf(visit: VisitView): StationRunRecord["status"] {
  if (visit.report !== null || visit.worker !== null) {
    return "running";
  }

  return visit.deadline !== null ? "claimed" : "queued";
}

function eventTypeOf(body: unknown): string {
  const type =
    typeof body === "object" && body !== null
      ? (body as { type?: unknown }).type
      : undefined;

  return typeof type === "string" ? type : "unknown";
}
