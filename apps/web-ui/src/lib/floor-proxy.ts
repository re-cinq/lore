import { NextResponse } from "next/server";
import { proxyUpstreamStatus } from "@/lib/api-error";
import { assemblyRunProxyRoute } from "@/lib/assembly-run-auth";
import type { UpstreamConfig } from "@/lib/floor-config";
import type { RunReadUpstream } from "@/lib/run-read-upstream";

/** Where one run-scoped read is answered on lore-api. */
type UpstreamOf = (runId: string, loreApi: UpstreamConfig) => RunReadUpstream;

/** A run-scoped paged JSON proxy to lore-api, with only the paging parameters forwarded. */
export function runPagedJsonRoute(
  errorContext: string,
  upstreamOf: UpstreamOf,
) {
  return assemblyRunProxyRoute(errorContext, async (ctx) =>
    proxyJson(
      await fetchPaged(
        upstreamOf(ctx.id, { upstreamUrl: ctx.upstreamUrl, token: ctx.token }),
        ctx.req,
      ),
    ),
  );
}

function fetchPaged(upstream: RunReadUpstream, req: Request) {
  const query = forwardedPagingQuery(new URL(req.url).searchParams);

  return fetch(`${upstream.url}${query}`, {
    headers: { Authorization: `Bearer ${upstream.token}` },
    signal: req.signal,
  });
}

/** The paging parameters, and only those. An allowlist rather than a pass-through: whatever else a caller appends must not reach lore-api as if this route had asked for it. */
export function forwardedPagingQuery(incoming: URLSearchParams): string {
  const forwarded = new URLSearchParams();

  for (const key of ["after", "limit"]) {
    const value = incoming.get(key);

    if (value !== null) {
      forwarded.set(key, value);
    }
  }

  return forwarded.size === 0 ? "" : `?${forwarded}`;
}

/** The upstream's JSON, passed through as-is. The body is never parsed — these routes proxy rather than interpret — and the status goes through `proxyUpstreamStatus` so an upstream auth failure reads as a gateway error rather than as the reader's own. */
export async function proxyJson(upstream: Response) {
  const body = await upstream.text();

  return new NextResponse(body, {
    status: proxyUpstreamStatus(upstream.status),
    headers: { "Content-Type": "application/json" },
  });
}
