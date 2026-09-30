import type { UpstreamConfig } from "./floor-config";

const FLOOR_ENGINE = "floor";

export interface TurnsUpstream {
  url: string;
  token: string;
}

/** Where a run's untruncated turns are read: lore-api for a run on the external floor, Lore's own Floor for every other. A floor run on a deployment with no lore-api configured falls back to the Floor, which answers an empty page. */
export function turnsUpstream(
  run: { id: string; engine?: string },
  floor: UpstreamConfig,
  loreApi: UpstreamConfig | null,
): TurnsUpstream {
  const id = encodeURIComponent(run.id);

  return run.engine === FLOOR_ENGINE && loreApi
    ? {
        url: `${loreApi.upstreamUrl}/api/assembly-runs/${id}/turns`,
        token: loreApi.token,
      }
    : { url: `${floor.upstreamUrl}/api/agent-turns/${id}`, token: floor.token };
}
