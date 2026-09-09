// IO glue for lore-api reads (excluded from coverage like trace-api.ts / webhook-api.ts).
import { resolveLoreApiConfig } from "@/lib/lore-api-config";

/** A read from lore-api with the web-ui's own token. Null covers both an unconfigured deployment and a refusing endpoint — the page has nothing to show either way. */
export async function loreApiGet<T>(pathAndQuery: string): Promise<T | null> {
  const config = resolveLoreApiConfig();

  if (!config) {
    return null;
  }
  const res = await fetch(`${config.apiUrl}${pathAndQuery}`, {
    signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${config.token}` },
    cache: "no-store",
  });

  if (!res.ok) {
    return null;
  }

  return (await res.json()) as T;
}
