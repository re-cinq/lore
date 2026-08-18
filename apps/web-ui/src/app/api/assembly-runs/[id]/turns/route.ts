export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { fetchAssemblyRun } from "@/lib/assembly-runs";
import { userCanAccessRepo } from "@/lib/user-repo-access";
import { serverError } from "@/lib/api-error";

/**
 * GET /api/assembly-runs/[id]/turns — session-authed proxy for one run's
 * full-fidelity turns, forwarding to the Floor's /api/agent-turns/{id}
 * (specs/turn-level-transcript-store, #1148). The sibling of the ./events
 * proxy: same auth ladder, same forwarded paging params, but the rows carry
 * the UNTRUNCATED envelopes, so this backs the on-demand full-transcript view
 * rather than the live projection.
 *
 * The auth ladder is cloned from the events route in the same order:
 * session (401) → run lookup (404) → repo access (403).
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
      `${floorUrl}/api/agent-turns/${encodeURIComponent(id)}${query}`,
      { headers: { Authorization: `Bearer ${token}` }, signal: req.signal },
    );
    const body = await upstream.text();

    return new NextResponse(body, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return serverError("assembly-line-run-turns", err);
  }
}
