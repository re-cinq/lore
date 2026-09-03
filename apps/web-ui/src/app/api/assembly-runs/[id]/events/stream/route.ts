export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { fetchAssemblyRun } from "@/lib/assembly-runs";
import { userCanAccessRepo } from "@/lib/user-repo-access";
import { serverError } from "@/lib/api-error";

// Session-authed SSE proxy to the Floor's /api/agent-events/stream/{id} (cookie→bearer token exchange). Keep upstream.body un-awaited (streamed, not buffered), req.signal forwarded, and no-transform/X-Accel-Buffering headers repeated per hop (spec FR4.8); Node runtime required, not edge.
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
