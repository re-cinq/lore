export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { fetchAssemblyRunNodes } from "@/lib/assembly-runs";
import {
  authorizeAssemblyRunAccess,
  isAssemblyRunAuthError,
} from "@/lib/assembly-run-auth";
import { proxyUpstreamStatus, serverError } from "@/lib/api-error";

// Proxy for one node's live pod logs via the Floor's /api/agent-logs/{name} (UI SA has no cluster access); Floor 401/403 surface as 502.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; name: string }> },
) {
  const { id, name } = await params;

  try {
    // Authorize before probing the node table so an unauthorized user can't distinguish a valid agentCrName from an invalid one.
    const auth = await authorizeAssemblyRunAccess(id);

    if (isAssemblyRunAuthError(auth)) {
      return auth;
    }

    const { floorUrl, token } = auth;
    const nodes = await fetchAssemblyRunNodes(id);
    const node = nodes.find((n) => n.agentCrName === name);

    if (!node) {
      return NextResponse.json(
        { error: "Node not found for this run" },
        { status: 404 },
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
