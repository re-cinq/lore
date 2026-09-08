import { NextResponse } from "next/server";
import { proxyUpstreamStatus } from "@/lib/api-error";

/** The paging parameters, and only those. An allowlist rather than a pass-through: whatever else a caller appends must not reach the Floor as if this route had asked for it. */
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

/** The Floor's JSON, passed through as-is. The body is never parsed — these routes proxy rather than interpret — and the status goes through `proxyUpstreamStatus` so a Floor auth failure reads as a gateway error rather than as the reader's own. */
export async function proxyJson(upstream: Response) {
  const body = await upstream.text();

  return new NextResponse(body, {
    status: proxyUpstreamStatus(upstream.status),
    headers: { "Content-Type": "application/json" },
  });
}
