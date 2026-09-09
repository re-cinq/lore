export const dynamic = "force-dynamic";
import { assemblyRunProxyRoute } from "@/lib/assembly-run-auth";
import { proxyJson } from "@/lib/floor-proxy";

// Session-authed proxy to lore-api's /api/assembly-runs/{id}/dod (specs/implementation-loop FR16): the page re-reads it on mount and whenever the stream reports the run or its CI checks changed.
export const GET = assemblyRunProxyRoute(
  "assembly-run-dod",
  async ({ id, req, upstreamUrl, token }) =>
    proxyJson(
      await fetch(
        `${upstreamUrl}/api/assembly-runs/${encodeURIComponent(id)}/dod`,
        { headers: { Authorization: `Bearer ${token}` }, signal: req.signal },
      ),
    ),
  "lore-api",
);
