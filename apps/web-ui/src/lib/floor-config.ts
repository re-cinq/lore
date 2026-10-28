import { resolveLoreApiConfig } from "@/lib/lore-api-config";

/** The backend a run proxy talks to. There is one: lore-api answers every run read, for a run of either engine. */
export type RunUpstream = "lore-api";

export interface UpstreamConfig {
  upstreamUrl: string;
  token: string;
}

const UPSTREAMS: Record<RunUpstream, () => Promise<UpstreamConfig | null>> = {
  "lore-api": async () => {
    const config = await resolveLoreApiConfig();

    return config && { upstreamUrl: config.apiUrl, token: config.token };
  },
};

/** The upstream's URL + the person's bearer token, or null when either is missing. */
export function resolveUpstreamConfig(
  upstream: RunUpstream,
): Promise<UpstreamConfig | null> {
  return UPSTREAMS[upstream]();
}
