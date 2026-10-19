export const dynamic = "force-dynamic";
import { assemblyRunProxyRoute } from "@/lib/assembly-run-auth";
import { proxyJson } from "@/lib/floor-proxy";

// Session-authed proxy to lore-api's /api/assembly-runs/{id}/bag (run-viz FR4.4n): the run page reads the floor's bag for the run on mount and whenever the run or a node moved.
export const GET = assemblyRunProxyRoute(
  "assembly-run-bag",
  async ({ id, req, upstreamUrl, token }) =>
    proxyJson(
      await fetch(
        `${upstreamUrl}/api/assembly-runs/${encodeURIComponent(id)}/bag`,
        { headers: { Authorization: `Bearer ${token}` }, signal: req.signal },
      ),
    ),
  "lore-api",
);
