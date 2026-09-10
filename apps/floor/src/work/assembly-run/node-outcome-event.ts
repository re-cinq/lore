/** Telling the graph what one node's terminal outcome was (issue #1771). The Floor never writes Dgraph itself, so this rides the ingest lane the same way a test report does. */

/** The blueprint the ingest lane itself runs under. An ingest run must never record its node outcomes: a recorded outcome is an ingest event, which starts another ingest run, which would record again, forever (#2007). */
const INGEST_BLUEPRINT = "ingest";

/** WHO the node was. Identity and the commit it ran at — the only things the station-run row can be trusted for here, because the row is read BEFORE the finish writes the verdict onto it. */
export interface SettledNode {
  stationRunId: string;
  nodeId: string;
  iteration: number;
  commitSha: string | null;
}

/** WHAT the node did. Carried by the delivery, never read back off the row. */
export interface NodeVerdict {
  outcome: string;
  failureClass?: string | null;
  failureDetail?: string | null;
}

/** The ingest event carrying one node's terminal outcome; the graph decides from `outcome` whether this projects a failure or resolves earlier ones. */
export function nodeOutcomeEvent(
  run: { id: string; repo: string | null },
  row: SettledNode,
  verdict: NodeVerdict,
  occurredAt: Date,
) {
  return {
    eventName: "internal.ingest.spec_trace",
    params: {
      repo: run.repo,
      kind: "failure",
      payload: outcomePayload(run.id, row, verdict, occurredAt),
    },
    dedupeKey: `node-outcome:${row.stationRunId}:${verdict.outcome}`,
  };
}

/** The settled node as the graph consumes it; `outcome` is what tells a resolve from a new failure. */
function outcomePayload(
  assemblyRunId: string,
  row: SettledNode,
  verdict: NodeVerdict,
  occurredAt: Date,
) {
  return {
    outcome: verdict.outcome,
    assemblyRunId,
    stationRunId: row.stationRunId,
    nodeId: row.nodeId,
    iteration: row.iteration,
    failureClass: verdict.failureClass ?? null,
    failureDetail: verdict.failureDetail ?? null,
    commit: row.commitSha,
    occurredAt: occurredAt.toISOString(),
  };
}

/** Whether this settled node is worth telling the graph about: only a run with a repo, and never an ingest run — recording its outcome starts another ingest run, whose outcome would start the next (the 2026-09-10 loop). */
export function shouldRecordOutcome(run: {
  repo: string | null;
  blueprintName: string;
}): boolean {
  return run.blueprintName !== INGEST_BLUEPRINT && Boolean(run.repo);
}
