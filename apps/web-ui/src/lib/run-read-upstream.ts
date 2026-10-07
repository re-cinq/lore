import type { UpstreamConfig } from "./floor-config";

export interface RunReadUpstream {
  url: string;
  token: string;
}

/** A run's untruncated turns. */
export function turnsUpstream(
  runId: string,
  loreApi: UpstreamConfig,
): RunReadUpstream {
  return runRead(runId, loreApi, "turns");
}

/** A run's persisted agent events, the history the page folds before it opens the channel. */
export function eventsUpstream(
  runId: string,
  loreApi: UpstreamConfig,
): RunReadUpstream {
  return runRead(runId, loreApi, "events");
}

/** One node's logs: the stdout Postgres stored for it, or the floor's log records of the visit. */
export function nodeLogsUpstream(
  runId: string,
  agentCrName: string,
  loreApi: UpstreamConfig,
): RunReadUpstream {
  return runRead(
    runId,
    loreApi,
    `nodes/${encodeURIComponent(agentCrName)}/logs`,
  );
}

/** A run-scoped read on lore-api, which answers it for a run of either engine: from Postgres for a run Lore's own Floor walked, from the external floor otherwise. */
function runRead(
  runId: string,
  loreApi: UpstreamConfig,
  read: string,
): RunReadUpstream {
  return {
    url: `${loreApi.upstreamUrl}/api/assembly-runs/${encodeURIComponent(runId)}/${read}`,
    token: loreApi.token,
  };
}
