import { NextResponse } from "next/server";
import { proxyUpstreamStatus } from "@/lib/api-error";

/** The upstream's JSON, passed through as-is. The body is never parsed — these routes proxy rather than interpret — and the status goes through `proxyUpstreamStatus` so an upstream auth failure reads as a gateway error rather than as the reader's own. */
export async function proxyJson(upstream: Response) {
  const body = await upstream.text();

  return new NextResponse(body, {
    status: proxyUpstreamStatus(upstream.status),
    headers: { "Content-Type": "application/json" },
  });
}
