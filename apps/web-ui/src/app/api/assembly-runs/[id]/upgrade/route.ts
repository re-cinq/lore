export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import {
  authorizeAssemblyRunAccess,
  isAssemblyRunAuthError,
  type AssemblyRunAuth,
} from "@/lib/assembly-run-auth";
import { serverError } from "@/lib/api-error";

// "Upgrade assembly line" backend: authorizes against the run's repo, then asks lore-api to start the newest version of the run's line with the source run's inputs, and sends the browser to the run it started.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    return await upgrade(req, (await params).id);
  } catch (err) {
    return serverError("assembly-run-upgrade", err);
  }
}

async function upgrade(req: Request, runId: string): Promise<Response> {
  const auth = await authorizeAssemblyRunAccess(runId);

  if (isAssemblyRunAuthError(auth)) {
    return auth;
  }
  const response = await askLoreApi(auth);

  if (!response.ok) {
    return NextResponse.json(
      { error: `lore-api returned ${response.status}` },
      { status: response.status },
    );
  }
  const { run_id } = (await response.json()) as { run_id: string };

  return NextResponse.redirect(
    new URL(`/assembly-runs/${encodeURIComponent(run_id)}`, req.url),
    { status: 303 },
  );
}

function askLoreApi(auth: AssemblyRunAuth): Promise<Response> {
  return fetch(
    `${auth.upstreamUrl}/api/assembly-runs/${encodeURIComponent(auth.run.id)}/upgrade`,
    {
      signal: AbortSignal.timeout(30_000),
      method: "POST",
      headers: { Authorization: `Bearer ${auth.token}` },
    },
  );
}
