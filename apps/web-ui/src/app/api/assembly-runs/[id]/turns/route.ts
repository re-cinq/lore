export const dynamic = "force-dynamic";
import { assemblyRunProxyRoute } from "@/lib/assembly-run-auth";
import { resolveUpstreamConfig } from "@/lib/floor-config";
import { forwardedPagingQuery, proxyJson } from "@/lib/floor-proxy";
import { turnsUpstream } from "@/lib/run-turns-upstream";

// Sibling of ./events: proxies UNTRUNCATED turns (#1148) for the on-demand full-transcript view; same 401→404→403 auth ladder. A run on the external floor keeps its turns there, and lore-api reads them.
export const GET = assemblyRunProxyRoute(
  "assembly-line-run-turns",
  async ({ id, run, req, upstreamUrl, token }) => {
    const upstream = turnsUpstream(
      { id, engine: run.engine },
      { upstreamUrl, token },
      resolveUpstreamConfig("lore-api"),
    );
    const query = forwardedPagingQuery(new URL(req.url).searchParams);

    return proxyJson(
      await fetch(`${upstream.url}${query}`, {
        headers: { Authorization: `Bearer ${upstream.token}` },
        signal: req.signal,
      }),
    );
  },
);
