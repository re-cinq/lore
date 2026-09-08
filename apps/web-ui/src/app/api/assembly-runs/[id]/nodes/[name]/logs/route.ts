export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { fetchAssemblyRunNodes } from "@/lib/assembly-runs";
import {
  authorizeAssemblyRunAccess,
  isAssemblyRunAuthError,
} from "@/lib/assembly-run-auth";
import { serverError } from "@/lib/api-error";
import { proxyJson } from "@/lib/floor-proxy";

/** One node's logs from the Floor. The 30s ceiling is deliberate: reading a pod's logs is a cluster round trip, and a reader waiting on a spinner is better served by an error than by a request that never returns. */
function fetchNodeLogs(
  floorUrl: string,
  token: string,
  name: string,
  tail: string | null,
) {
  const query = tail ? `?tail=${encodeURIComponent(tail)}` : "";

  return fetch(
    `${floorUrl}/api/agent-logs/${encodeURIComponent(name)}${query}`,
    {
      signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

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

    return proxyJson(await fetchNodeLogs(floorUrl, token, name, tail));
  } catch (err) {
    return serverError("assembly-line-node-logs", err);
  }
}
