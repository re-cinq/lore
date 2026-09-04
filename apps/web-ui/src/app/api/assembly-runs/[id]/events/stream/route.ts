export const dynamic = "force-dynamic";
import {
  authorizeAssemblyRunAccess,
  isAssemblyRunAuthError,
} from "@/lib/assembly-run-auth";
import { NextResponse } from "next/server";
import { serverError } from "@/lib/api-error";

// Session-authed SSE proxy to the Floor's /api/agent-events/stream/{id} (cookie→bearer token exchange). Keep upstream.body un-awaited (streamed, not buffered), req.signal forwarded, and no-transform/X-Accel-Buffering headers repeated per hop (spec FR4.8); Node runtime required, not edge.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const auth = await authorizeAssemblyRunAccess(id);

    if (isAssemblyRunAuthError(auth)) {
      return auth;
    }

    const { floorUrl, token } = auth;
    const after = new URL(req.url).searchParams.get("after");
    const query = after === null ? "" : `?after=${encodeURIComponent(after)}`;
    const lastEventId = req.headers.get("Last-Event-ID");
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "text/event-stream",
    };

    if (lastEventId !== null) {
      headers["Last-Event-ID"] = lastEventId;
    }

    const upstream = await fetch(
      `${floorUrl}/api/agent-events/stream/${encodeURIComponent(id)}${query}`,
      { headers, signal: req.signal },
    );

    // A Floor error is returned as JSON with status preserved, never piped as an event-stream — that made an outage indistinguishable from a blip.
    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Floor stream unavailable (${upstream.status})` },
        { status: upstream.status },
      );
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    return serverError("assembly-line-run-events-stream", err);
  }
}
