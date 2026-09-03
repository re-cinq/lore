// Mirrors AgentRunTurnRow with type-drift guard (createdAt: string from JSON; eventType unnarrowed; #1419).

export interface AgentRunTurn {
  id: string;
  taskId: string | null;
  agentCrName: string | null;
  assemblyLineId: string | null;
  nodeId: string | null;
  iteration: number | null;
  stationRunId: string | null;
  eventType: string | null;
  /** The untruncated `{source, event}` line. */
  envelope: Record<string, unknown>;
  createdAt: string;
}

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

/** Validates and coerces a row; returns null for missing id/createdAt. */
export function parseAgentRunTurn(value: unknown): AgentRunTurn | null {
  const body = record(value);
  const id = str(body.id);
  const createdAt = str(body.createdAt);

  if (id === null || createdAt === null) {
    return null;
  }

  return {
    id,
    taskId: str(body.taskId),
    agentCrName: str(body.agentCrName),
    assemblyLineId: str(body.assemblyLineId),
    nodeId: str(body.nodeId),
    iteration: num(body.iteration),
    stationRunId: str(body.stationRunId),
    eventType: str(body.eventType),
    envelope: record(body.envelope),
    createdAt,
  };
}
