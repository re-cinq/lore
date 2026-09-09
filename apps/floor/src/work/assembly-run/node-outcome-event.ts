/** Telling the graph what one node's terminal outcome was (issue #1771). The Floor never writes Dgraph itself, so this rides the ingest lane the same way a test report does. */

/** The station-run fields the graph needs to record a failure or resolve one. */
export interface SettledNode {
  stationRunId: string;
  nodeId: string;
  iteration: number;
  failureClass: string | null;
  failureDetail: string | null;
  commitSha: string | null;
}

/** The ingest event carrying one node's terminal outcome; the graph decides from `outcome` whether this projects a failure or resolves earlier ones. */
export function nodeOutcomeEvent(
  run: { id: string; repo: string | null },
  row: SettledNode,
  outcome: string,
  occurredAt: Date,
) {
  return {
    eventName: "internal.ingest.spec_trace",
    params: {
      repo: run.repo,
      kind: "failure",
      payload: outcomePayload(run.id, row, { outcome, occurredAt }),
    },
    dedupeKey: `node-outcome:${row.stationRunId}:${outcome}`,
  };
}

/** The settled node as the graph consumes it; `outcome` is what tells a resolve from a new failure. */
function outcomePayload(
  assemblyRunId: string,
  row: SettledNode,
  when: { outcome: string; occurredAt: Date },
) {
  return {
    outcome: when.outcome,
    assemblyRunId,
    stationRunId: row.stationRunId,
    nodeId: row.nodeId,
    iteration: row.iteration,
    failureClass: row.failureClass,
    failureDetail: row.failureDetail,
    commit: row.commitSha,
    occurredAt: when.occurredAt.toISOString(),
  };
}

/** Whether this settled node is worth telling the graph about: only a run with a repo, and only a node whose outcome either failed or resolves an earlier failure. */
export function shouldRecordOutcome(run: { repo: string | null }): boolean {
  return Boolean(run.repo);
}
