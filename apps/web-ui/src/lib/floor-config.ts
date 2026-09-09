export interface FloorConfig {
  floorUrl: string;
  token: string;
}

/** The Floor's URL + bearer token, or null when either env var is unset. */
export function resolveFloorConfig(): FloorConfig | null {
  const floorUrl = process.env.LORE_FLOOR_URL;
  const token = process.env.LORE_INGEST_TOKEN;

  if (!floorUrl || !token) {
    return null;
  }

  return { floorUrl, token };
}

/** Which backend a run proxy talks to: the Floor for history, turns and pod logs; lore-api for the live stream (ADR-037 amendment 2026-09). */
export type RunUpstream = "floor" | "lore-api";

export interface UpstreamConfig {
  upstreamUrl: string;
  token: string;
}

const UPSTREAMS: Record<RunUpstream, () => UpstreamConfig | null> = {
  floor: () => {
    const floor = resolveFloorConfig();

    return floor && { upstreamUrl: floor.floorUrl, token: floor.token };
  },
  "lore-api": () => {
    const upstreamUrl = process.env.LORE_API_URL;
    const token = process.env.LORE_ADMIN_TOKEN ?? process.env.LORE_INGEST_TOKEN;

    return upstreamUrl && token ? { upstreamUrl, token } : null;
  },
};

/** The upstream's URL + bearer token, or null when its env is unset. */
export function resolveUpstreamConfig(
  upstream: RunUpstream,
): UpstreamConfig | null {
  return UPSTREAMS[upstream]();
}
