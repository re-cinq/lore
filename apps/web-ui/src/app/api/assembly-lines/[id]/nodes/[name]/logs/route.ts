export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import {
  fetchAssemblyLineRun,
  fetchAssemblyLineRunNodes,
} from "@/lib/assembly-line-runs";
import { userCanAccessRepo } from "@/lib/user-repo-access";
import { serverError } from "@/lib/api-error";

/**
 * GET /api/assembly-lines/[id]/nodes/[name]/logs — proxy for one node's live pod
 * logs. Resolves the run, confirms `name` is actually a node of it, checks the
 * user can see the repo, then proxies to the Floor's /api/agent-logs/{name}
 * (the UI SA has no cluster access; the Floor brokers the read). Passes `?tail`
 * through. Returns the Floor's `{ available, logs, phase, podName }` verbatim.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; name: string }> },
) {
  const { id, name } = await params;

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

    // Authorize before probing the node table, so an unauthorized user can't
    // distinguish a valid agentCrName (404 "not found") from an invalid one.
    if (!(await userCanAccessRepo(session.accessToken, run.repo))) {
      return NextResponse.json(
        { error: "Access denied — you do not have access to this repo" },
        { status: 403 },
      );
    }

    const nodes = await fetchAssemblyLineRunNodes(id);
    const node = nodes.find((n) => n.agentCrName === name);

    if (!node) {
      return NextResponse.json(
        { error: "Node not found for this run" },
        { status: 404 },
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

    const tail = new URL(req.url).searchParams.get("tail");
    const query = tail ? `?tail=${encodeURIComponent(tail)}` : "";
    const upstream = await fetch(
      `${floorUrl}/api/agent-logs/${encodeURIComponent(name)}${query}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const body = await upstream.text();

    return new NextResponse(body, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return serverError("assembly-line-node-logs", err);
  }
}
