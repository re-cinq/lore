export const dynamic = "force-dynamic";
import { assemblyRunProxyRoute } from "@/lib/assembly-run-auth";
import { proxyJson } from "@/lib/floor-proxy";

// Session-authed proxy to lore-api's /api/assembly-runs/{id}/blob-previews (run-viz FR4.4m): the run page shows a short file in place.
export const GET = assemblyRunProxyRoute(
  "assembly-run-blob-previews",
  async ({ id, req, upstreamUrl, token }) =>
    proxyJson(
      await fetch(
        `${upstreamUrl}/api/assembly-runs/${encodeURIComponent(id)}/blob-previews${new URL(req.url).search}`,
        { headers: { Authorization: `Bearer ${token}` }, signal: req.signal },
      ),
    ),
  "lore-api",
);
