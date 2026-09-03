// Mirrors AgentRunEventRow (isolated build + drift detection); createdAt divergence is structural (revisit per #1419).
export type AgentRunEventType =
  | "init"
  | "message"
  | "thinking"
  | "tool_call"
  | "tool_result"
  | "result"
  | "hook";

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
  "hook",
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
