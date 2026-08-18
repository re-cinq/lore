export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { fetchAssemblyRun } from "@/lib/assembly-runs";
import { userCanAccessRepo } from "@/lib/user-repo-access";
import { serverError } from "@/lib/api-error";

/**
 * GET /api/assembly-runs/[id]/events — session-authed history proxy for one
 * run's agent events, forwarding to the Floor's /api/agent-events/{id}. Keeps
 * the event history out of the RSC payload: the page ships the graph, the
 * client pages the events.
 *
 * The auth ladder is cloned from the node-logs route in the same order:
 * session (401) → run lookup (404) → repo access (403). An authenticated caller
 * CAN tell the two apart — 404 means the run does not exist, 403 means it does
 * but the repo is not theirs. The order is for consistency with the node-logs
 * route, not to collapse the codes.
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

    const incoming = new URL(req.url).searchParams;
    const forwarded = new URLSearchParams();

    for (const key of ["after", "limit"]) {
      const value = incoming.get(key);

      if (value !== null) {
        forwarded.set(key, value);
      }
    }

    const query = forwarded.size === 0 ? "" : `?${forwarded}`;
    const upstream = await fetch(
      `${floorUrl}/api/agent-events/${encodeURIComponent(id)}${query}`,
      { headers: { Authorization: `Bearer ${token}` }, signal: req.signal },
    );
    const body = await upstream.text();

    return new NextResponse(body, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return serverError("assembly-line-run-events", err);
  }
}
