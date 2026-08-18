export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { fetchAssemblyRun } from "@/lib/assembly-runs";
import { userCanAccessRepo } from "@/lib/user-repo-access";
import { serverError } from "@/lib/api-error";

/**
 * GET /api/assembly-runs/[id]/events/stream — session-authed SSE proxy to the
 * Floor's /api/agent-events/stream/{id}. EventSource cannot send an
 * Authorization header, so the browser's same-origin session cookie is the
 * credential and this route exchanges it for the Floor's bearer token.
 *
 * Three things here are load-bearing and easy to undo by accident:
 *  - `upstream.body` is handed back un-awaited. Reading it (.text()/.json())
 *    would buffer the whole stream and the page would show nothing until the
 *    run ended.
 *  - `req.signal` rides along, so closing the tab tears down the Floor stream
 *    instead of leaking a subscriber slot.
 *  - the no-transform / X-Accel-Buffering headers are repeated on this hop,
 *    because the proxy in front of the UI buffers on its own judgement, not the
 *    Floor's (spec FR4.8).
 *
 * Node runtime on purpose — no `export const runtime`. The edge runtime is not
 * needed and would change the fetch/stream semantics this depends on.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const session = (await getServerSession(authOptions)) as {
      accessToken?: string;
    } | null;

    if (!session?.accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const run = await fetchAssemblyRun(id);

    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    if (!(await userCanAccessRepo(session.accessToken, run.repo))) {
      return NextResponse.json(
        { error: "Access denied — you do not have access to this repo" },
        { status: 403 },
      );
    }

    const floorUrl = process.env.LORE_FLOOR_URL;
    const token = process.env.LORE_INGEST_TOKEN;

    if (!floorUrl || !token) {
      return NextResponse.json(
        { error: "LORE_FLOOR_URL/LORE_INGEST_TOKEN not configured" },
        { status: 500 },
      );
    }

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

    // A Floor error (404/503) is a JSON error with the status preserved, never
    // an empty `text/event-stream` — piping the error body as a stream made an
    // outage indistinguishable from a network blip on the wire. EventSource
    // cannot read the status either way; the client-side bounded give-up is
    // what actually stops the retry storm. This keeps the wire truthful for
    // every other client.
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
