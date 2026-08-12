// Hand mirror of AgentRunTurnRow from
// libs/shared/src/project/agent-run-turns/agent-run-turns-port.ts. web-ui is
// excluded from the npm workspace and built in an isolated Docker context, so it
// cannot import @re-cinq/lore-shared; scripts/type-drift/run-turn-types.drift.ts
// makes drift from the canonical type a compile-time failure.
//
// The one deliberate divergence: `createdAt` is a Date on the port and a string
// here, because this side only ever sees the JSON projection of the row. The
// drift guard is therefore keys-only, never structural.
//
// `eventType` stays `string | null`, never a union: the port deliberately does
// not narrow the raw stream-json kind, so a kind this client has never seen is
// still rendered under its own name instead of dropped.

export interface AgentRunTurn {
  id: string;
  taskId: string | null;
  agentCrName: string | null;
  assemblyLineId: string | null;
  nodeId: string | null;
  iteration: number | null;
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

/**
 * Validate one decoded row from the turns proxy into the mirrored shape.
 * Returns null — never throws — for a non-object body or a missing identity
 * field (`id`, `createdAt`); everything else is coerced, matching the port's
 * every-correlation-field-is-nullable contract.
 */
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
    eventType: str(body.eventType),
    envelope: record(body.envelope),
    createdAt,
  };
}
