// The run identity an agent event CARRIES, owned in one place (#1147).
//
// Agent pods POST claude stream-json NDJSON to the Floor, and the envelope's
// `source` object has until now named only the Agent CR (`source.agent`). Two
// sinks then INFER which run and which visit produced the row, by matching that
// name against `pipeline.station_runs` with a newest-row-wins tie-break:
// `llm_calls` (cost) and `agent_run_events` / `agent_run_turns` (run-viz).
//
// Inference makes correctness rest on invariants the write path cannot see. The
// sharp one: nothing may ever copy a node row with its `agent_cr_name` intact,
// or the copy steals the original's late-arriving rows. Fork-and-rerun hit
// exactly that and had to null the column on copy — a rule every future feature
// touching node rows must independently remember.
//
// So the producer states the identity instead, and this module is the ONE place
// the wire shape is declared. Field names are snake_case because they cross a
// process boundary into an externally-built pod image:
//
//   "source": { "task": …, "agent": …,
//               "assembly_run": <uuid>, "node": <id>, "iteration": <int>,
//               "station_run": <uuid|null> }
//
// READERS-FIRST: this repo accepts the field before anything emits it, so the
// producer change (#1237, in the ai-agent-subsystem repo) can ship on its own
// schedule with no coordinated deploy. Until then every envelope parses to null
// and the CR-name join stays in charge, which is why the fallback is not
// deletable yet.

/** The identity of one node visit, as stated by whoever produced the event. */
export interface CarriedRunIdentity {
  assemblyRunId: string;
  nodeId: string;
  iteration: number;
  /** Null from a producer that knows the visit but not its station-run uuid. */
  stationRunId: string | null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * The identity out of an event's `source` object, or null when it carries none.
 *
 * ALL OR NOTHING. A partial identity is worse than an absent one: it would pin
 * the row to a run while leaving which visit produced it to the join, mixing a
 * stated id with an inferred one into a row that is wrong in a way no reader can
 * detect. Missing anything means the CR-name fallback stays in charge — which is
 * the behaviour that works today.
 */
export function parseCarriedRunIdentity(
  source: unknown,
): CarriedRunIdentity | null {
  if (typeof source !== "object" || source === null) {
    return null;
  }

  const fields = source as Record<string, unknown>;
  const assemblyRunId = nonEmptyString(fields.assembly_run);
  const nodeId = nonEmptyString(fields.node);
  const iteration = fields.iteration;
  const namesTheVisit = assemblyRunId !== null && nodeId !== null;
  const countsTheIteration =
    typeof iteration === "number" && Number.isInteger(iteration);

  if (!namesTheVisit || !countsTheIteration) {
    return null;
  }

  return {
    assemblyRunId,
    nodeId,
    iteration,
    stationRunId: nonEmptyString(fields.station_run),
  };
}
