// Hand mirror of AgentRunEventRow from
// libs/shared/src/project/agent-run-events/agent-run-events-port.ts. web-ui is
// excluded from the npm workspace and built in an isolated Docker context, so it
// cannot import @re-cinq/lore-shared; scripts/type-drift/run-stream-types.drift.ts
// makes drift from the canonical type a compile-time failure.
//
// The one deliberate divergence: `createdAt` is a Date on the port and a string
// here, because this side only ever sees the JSON projection of the row. The
// drift guard is therefore keys-only, never structural.

export type AgentRunEventType =
  "init" | "message" | "thinking" | "tool_call" | "tool_result" | "result";

export interface RunStreamEvent {
  id: string;
  taskId: string;
  agentCrName: string | null;
  assemblyLineId: string | null;
  stationRunId: string | null;
  nodeId: string | null;
  iteration: number | null;
  eventType: AgentRunEventType;
  toolName: string | null;
  toolUseId: string | null;
  isError: boolean;
  filePaths: string[];
  summary: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

const EVENT_TYPES: ReadonlySet<string> = new Set<AgentRunEventType>([
  "init",
  "message",
  "thinking",
  "tool_call",
  "tool_result",
  "result",
]);

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isEventType(value: string | null): value is AgentRunEventType {
  return value !== null && EVENT_TYPES.has(value);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
}

/**
 * Parse one SSE `data:` payload into the mirrored row. Returns null — never
 * throws — for malformed JSON, a non-object body, a missing identity field, or
 * an `eventType` this client does not know. Dropping unknown event types
 * silently is the forward-compatibility contract: the Floor may add a seventh
 * stream-json kind without breaking a deployed browser tab.
 */
export function parseRunStreamEvent(raw: string): RunStreamEvent | null {
  try {
    return parseRunStreamRow(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * The same validation over an already-decoded row. The REST history endpoint
 * hands back parsed JSON objects, so re-stringifying them just to feed
 * parseRunStreamEvent would be the only alternative. Same rules, same nulls.
 */
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

  return {
    id,
    taskId,
    agentCrName: str(body.agentCrName),
    assemblyLineId: str(body.assemblyLineId),
    stationRunId: str(body.stationRunId),
    nodeId: str(body.nodeId),
    iteration: num(body.iteration),
    eventType,
    toolName: str(body.toolName),
    toolUseId: str(body.toolUseId),
    isError: body.isError === true,
    filePaths: stringList(body.filePaths),
    summary: str(body.summary),
    payload: record(body.payload),
    createdAt,
  };
}
