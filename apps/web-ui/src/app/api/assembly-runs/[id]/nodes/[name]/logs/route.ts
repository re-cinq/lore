export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { fetchAssemblyRunNodes } from "@/lib/assembly-runs";
import {
  authorizeAssemblyRunAccess,
  isAssemblyRunAuthError,
} from "@/lib/assembly-run-auth";
import { serverError } from "@/lib/api-error";
import { proxyJson } from "@/lib/floor-proxy";
import { nodeLogsUpstream } from "@/lib/run-read-upstream";

// Proxy for one node's logs via lore-api, which answers for a run of either engine; an upstream 401/403 surfaces as 502.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; name: string }> },
) {
  const { id, name } = await params;

  try {
    return await nodeLogsResponse(req, id, name);
  } catch (err) {
    return serverError("assembly-line-node-logs", err);
  }
}

/** Authorize, then resolve the CR name against this run's nodes, then proxy. Order matters: the node lookup only ever happens for a caller already allowed to see the run. */
async function nodeLogsResponse(req: Request, id: string, name: string) {
  // Authorize before probing the node table so an unauthorized user can't distinguish a valid agentCrName from an invalid one.
  const auth = await authorizeAssemblyRunAccess(id);

  if (isAssemblyRunAuthError(auth)) {
    return auth;
  }

  const nodes = await fetchAssemblyRunNodes(id);

  if (!nodes.some((n) => n.agentCrName === name)) {
    return NextResponse.json(
      { error: "Node not found for this run" },
      { status: 404 },
    );
  }
  const tail = new URL(req.url).searchParams.get("tail");

  return proxyJson(
    await fetchNodeLogs(nodeLogsUpstream(auth.run.id, name, auth), tail),
  );
}

/** One node's logs from lore-api. The 30s ceiling is deliberate: a reader waiting on a spinner is better served by an error than by a request that never returns. */
function fetchNodeLogs(
  upstream: { url: string; token: string },
  tail: string | null,
) {
  const query = tail ? `?tail=${encodeURIComponent(tail)}` : "";

  return fetch(`${upstream.url}${query}`, {
    signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${upstream.token}` },
  });
}
