import type { components } from "./api/schema";
import { num, record, str } from "./json-field";

/** The one multiplexed run stream's frame, as lore-api publishes it (ADR-037 amendment 2026-09): generated from the OpenAPI contract, so there is no hand mirror to drift. */
export type RunStreamFrame = components["schemas"]["RunStreamFrame"];

export type AgentEventFrame = Extract<RunStreamFrame, { type: "agent_event" }>;
export type NodeStatusFrame = Extract<RunStreamFrame, { type: "node_status" }>;
export type RunStatusFrame = Extract<RunStreamFrame, { type: "run_status" }>;
export type TaskEventFrame = Extract<RunStreamFrame, { type: "task_event" }>;
export type CiCheckFrame = Extract<RunStreamFrame, { type: "ci_check" }>;

/** One projected agent event — the `agent_event` frame's payload, and the shape the history endpoint pages. */
export type RunStreamEvent = AgentEventFrame["event"];

export type AgentRunEventType = RunStreamEvent["eventType"];

const EVENT_TYPES: ReadonlySet<string> = new Set<AgentRunEventType>([
  "init",
  "message",
  "thinking",
  "tool_call",
  "tool_result",
  "result",
  "hook",
]);

/** The frame types the reducers know; anything else is dropped for forward-compatibility. */
const FRAME_TYPES: ReadonlySet<string> = new Set<RunStreamFrame["type"]>([
  "agent_event",
  "node_status",
  "run_status",
  "task_event",
  "ci_check",
  "catchup_complete",
]);

/** Parse SSE payload; returns null on error; silently drops unknown event types for forward-compatibility. */
export function parseRunStreamEvent(raw: string): RunStreamEvent | null {
  try {
    return parseRunStreamRow(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Validates an already-decoded row without re-stringifying. */
export function parseRunStreamRow(value: unknown): RunStreamEvent | null {
  const body = record(value);
  const id = str(body.id);
  const taskId = str(body.taskId);
  const createdAt = str(body.createdAt);
  const eventType = str(body.eventType);

  if (id === null || taskId === null) {
    return null;
  }

  if (createdAt === null || !isEventType(eventType)) {
    return null;
  }

  return { id, taskId, eventType, createdAt, ...optionalEventFields(body) };
}

function isEventType(value: string | null): value is AgentRunEventType {
  return value !== null && EVENT_TYPES.has(value);
}

/** Every field a row may omit; each one narrows to null/empty rather than rejecting the row. */
function optionalEventFields(
  body: Record<string, unknown>,
): Omit<RunStreamEvent, "id" | "taskId" | "eventType" | "createdAt"> {
  return {
    agentCrName: str(body.agentCrName),
    assemblyLineId: str(body.assemblyLineId),
    stationRunId: str(body.stationRunId),
    nodeId: str(body.nodeId),
    iteration: num(body.iteration),
    toolName: str(body.toolName),
    toolUseId: str(body.toolUseId),
    isError: body.isError === true,
    filePaths: stringList(body.filePaths),
    summary: str(body.summary),
    payload: record(body.payload),
  };
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
}

/** The key each state family must carry to be applicable; a frame missing it is dropped rather than applied half-formed. */
const FRAME_KEYS: Record<
  Exclude<RunStreamFrame["type"], "agent_event">,
  [string, string]
> = {
  node_status: ["node", "node_id"],
  run_status: ["run", "id"],
  task_event: ["event", "id"],
  ci_check: ["check", "repo"],
  catchup_complete: ["last_id", ""],
};

/** Parse one SSE frame's data. An agent event is validated field by field (it feeds the reducer's fold); the state families are checked for their key and otherwise trusted, since they are re-sent whole on every reconnect. */
export function parseRunStreamFrame(raw: string): RunStreamFrame | null {
  try {
    return classifyFrame(record(JSON.parse(raw)));
  } catch {
    return null;
  }
}

function classifyFrame(body: Record<string, unknown>): RunStreamFrame | null {
  const type = str(body.type);

  if (type === null || !FRAME_TYPES.has(type)) {
    return null;
  }

  if (type === "agent_event") {
    const event = parseRunStreamRow(body.event);

    return event === null ? null : { type, event };
  }
  const kind = type as keyof typeof FRAME_KEYS;

  return hasKey(body, FRAME_KEYS[kind])
    ? (body as unknown as RunStreamFrame)
    : null;
}

function hasKey(
  body: Record<string, unknown>,
  [member, field]: [string, string],
): boolean {
  if (field === "") {
    return str(body[member]) !== null;
  }

  return str(record(body[member])[field]) !== null;
}
