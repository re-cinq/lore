/** The backend a run proxy talks to. There is one: lore-api answers every run read, for a run of either engine. */
export type RunUpstream = "lore-api";

export interface UpstreamConfig {
  upstreamUrl: string;
  token: string;
}

const UPSTREAMS: Record<RunUpstream, () => UpstreamConfig | null> = {
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
