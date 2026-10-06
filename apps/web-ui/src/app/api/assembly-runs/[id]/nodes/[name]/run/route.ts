export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import {
  authorizeAssemblyRunAccess,
  isAssemblyRunAuthError,
  type AssemblyRunAuth,
} from "@/lib/assembly-run-auth";
import { serverError } from "@/lib/api-error";
import { proxyJson } from "@/lib/floor-proxy";
import { planUserOf, type PlanSession } from "@/lib/plan-user";
import { getSession } from "@/lib/session";

// "Run this station" backend: authorizes against the run's repo, then asks lore-api to have the floor run the node again in the signed-in person's name. The segment is `[name]` because Next.js allows one slug name per level and the logs route named it first.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; name: string }> },
) {
  const { id, name } = await params;

  try {
    return await runNode(id, name);
  } catch (err) {
    return serverError("assembly-run-node-run", err);
  }
}

async function runNode(runId: string, nodeId: string): Promise<Response> {
  const auth = await authorizeAssemblyRunAccess(runId);

  if (isAssemblyRunAuthError(auth)) {
    return auth;
  }
  const user = planUserOf((await getSession()) as PlanSession | null);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return proxyJson(await askLoreApi(auth, nodeId, user.id));
}

function askLoreApi(
  auth: AssemblyRunAuth,
  nodeId: string,
  requestedBy: string,
): Promise<Response> {
  return fetch(
    `${auth.upstreamUrl}/api/assembly-runs/${encodeURIComponent(auth.run.id)}/nodes/${encodeURIComponent(nodeId)}/run`,
    {
      signal: AbortSignal.timeout(30_000),
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ requested_by: requestedBy }),
    },
  );
}
