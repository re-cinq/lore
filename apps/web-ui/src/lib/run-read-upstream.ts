import type { UpstreamConfig } from "./floor-config";

const FLOOR_ENGINE = "floor";

export interface RunReadUpstream {
  url: string;
  token: string;
}

/** The two spellings of one run-scoped read: the Floor's own path and lore-api's. */
interface RunReadPaths {
  floor: (id: string) => string;
  loreApi: (id: string) => string;
}

/** Where a run-scoped read is answered: lore-api for a run on the external floor, Lore's own Floor for every other. A floor run on a deployment with no lore-api configured falls back to the Floor, which answers an empty page. */
export function runReadUpstream(
  run: { id: string; engine?: string },
  floor: UpstreamConfig,
  loreApi: UpstreamConfig | null,
  paths: RunReadPaths,
): RunReadUpstream {
  const id = encodeURIComponent(run.id);

  return run.engine === FLOOR_ENGINE && loreApi
    ? {
        url: `${loreApi.upstreamUrl}${paths.loreApi(id)}`,
        token: loreApi.token,
      }
    : { url: `${floor.upstreamUrl}${paths.floor(id)}`, token: floor.token };
}

/** A run's untruncated turns. */
export function turnsUpstream(
  run: { id: string; engine?: string },
  floor: UpstreamConfig,
  loreApi: UpstreamConfig | null,
): RunReadUpstream {
  return runReadUpstream(run, floor, loreApi, {
    floor: (id) => `/api/agent-turns/${id}`,
    loreApi: (id) => `/api/assembly-runs/${id}/turns`,
  });
}

/** A run's persisted agent events, the history the page folds before it opens the channel. */
export function eventsUpstream(
  run: { id: string; engine?: string },
  floor: UpstreamConfig,
  loreApi: UpstreamConfig | null,
): RunReadUpstream {
  return runReadUpstream(run, floor, loreApi, {
    floor: (id) => `/api/agent-events/${id}`,
    loreApi: (id) => `/api/assembly-runs/${id}/events`,
  });
}

/** One node's logs: the Floor reads its pod, lore-api reads the floor's log records of the visit. */
export function nodeLogsUpstream(
  run: { id: string; engine?: string },
  agentCrName: string,
  floor: UpstreamConfig,
  loreApi: UpstreamConfig | null,
): RunReadUpstream {
  const name = encodeURIComponent(agentCrName);

  return runReadUpstream(run, floor, loreApi, {
    floor: () => `/api/agent-logs/${name}`,
    loreApi: (id) => `/api/assembly-runs/${id}/nodes/${name}/logs`,
  });
}
