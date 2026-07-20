export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { fetchAssemblyLineRun } from "@/lib/assembly-line-runs";
import { userCanAccessRepo } from "@/lib/user-repo-access";
import { serverError } from "@/lib/api-error";

/**
 * GET /api/assembly-lines/[id]/events — session-authed history proxy for one
 * run's agent events, forwarding to the Floor's /api/agent-events/{id}. Keeps
 * the event history out of the RSC payload: the page ships the graph, the
 * client pages the events.
 *
 * The auth ladder is cloned from the node-logs route in the same order
 * (session → run → repo access) so a 403 and a 404 never let a caller
 * distinguish "not yours" from "does not exist".
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

    const run = await fetchAssemblyLineRun(id);

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
      { headers: { Authorization: `Bearer ${token}` } },
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
