export const dynamic = "force-dynamic";
import { assemblyRunProxyRoute } from "@/lib/assembly-run-auth";
import { NextResponse } from "next/server";

/** A Floor error, as JSON with its status preserved — never piped through as an event-stream. Streamed, an outage is indistinguishable from a run that has simply gone quiet. */
function floorUnavailable(status: number) {
  return NextResponse.json(
    { error: `Floor stream unavailable (${status})` },
    { status },
  );
}

/** Carries the reader's resume point upstream. `Last-Event-ID` is only set when the browser sent one, since an empty value would read as "resume from the start" rather than "no cursor". */
function streamHeaders(token: string, req: Request): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "text/event-stream",
  };
  const lastEventId = req.headers.get("Last-Event-ID");

  if (lastEventId !== null) {
    headers["Last-Event-ID"] = lastEventId;
  }

  return headers;
}

/** Repeated per hop (spec FR4.8): a proxy that buffers or transforms the stream turns a live run into one that appears frozen. */
const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no",
};

// Session-authed SSE proxy to the Floor's /api/agent-events/stream/{id} (cookie→bearer token exchange). Keep upstream.body un-awaited (streamed, not buffered), req.signal forwarded, and no-transform/X-Accel-Buffering headers repeated per hop (spec FR4.8); Node runtime required, not edge.
export const GET = assemblyRunProxyRoute(
  "assembly-line-run-events-stream",
  async ({ id, req, floorUrl, token }) => {
    const after = new URL(req.url).searchParams.get("after");
    const query = after === null ? "" : `?after=${encodeURIComponent(after)}`;
    const upstream = await fetch(
      `${floorUrl}/api/agent-events/stream/${encodeURIComponent(id)}${query}`,
      { headers: streamHeaders(token, req), signal: req.signal },
    );

    if (!upstream.ok) {
      return floorUnavailable(upstream.status);
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: SSE_HEADERS,
    });
  },
);
