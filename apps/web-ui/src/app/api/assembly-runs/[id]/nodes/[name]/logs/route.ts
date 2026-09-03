export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { fetchAssemblyRun, fetchAssemblyRunNodes } from "@/lib/assembly-runs";
import { userCanAccessRepo } from "@/lib/user-repo-access";
import { proxyUpstreamStatus, serverError } from "@/lib/api-error";

// Proxy for one node's live pod logs via the Floor's /api/agent-logs/{name} (UI SA has no cluster access); Floor 401/403 surface as 502.
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

    const run = await fetchAssemblyRun(id);

    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    // Authorize before probing the node table so an unauthorized user can't distinguish a valid agentCrName from an invalid one.
    if (!(await userCanAccessRepo(session.accessToken, run.repo))) {
      return NextResponse.json(
        { error: "Access denied — you do not have access to this repo" },
        { status: 403 },
      );
    }

    const nodes = await fetchAssemblyRunNodes(id);
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
      {
        signal: AbortSignal.timeout(30_000),
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    const body = await upstream.text();

    return new NextResponse(body, {
      status: proxyUpstreamStatus(upstream.status),
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return serverError("assembly-line-node-logs", err);
  }
}
