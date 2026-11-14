import { NextResponse } from "next/server";
import { fetchAssemblyRun, type AssemblyRun } from "@/lib/assembly-runs";
import { sessionToken } from "@/lib/session-token";
import type { RunUpstream, UpstreamConfig } from "@/lib/floor-config";
import { authorizeRepoUpstreamAccess } from "@/lib/floor-access";

export interface AssemblyRunAuth extends UpstreamConfig {
  run: AssemblyRun;
}

/** Type guard narrowing an {@link authorizeAssemblyRunAccess} result to the error response. */
export function isAssemblyRunAuthError(
  result: AssemblyRunAuth | NextResponse,
): result is NextResponse {
  return result instanceof NextResponse;
}

/** Session → run → repo-access → upstream-env ladder shared by every run proxy route. */
export async function authorizeAssemblyRunAccess(
  id: string,
  upstream: RunUpstream = "lore-api",
): Promise<AssemblyRunAuth | NextResponse> {
  const run = await resolveSessionRun(id);

  if (run instanceof NextResponse) {
    return run;
  }
  const config = await authorizeRepoUpstreamAccess(run.repo, upstream);

  return config instanceof NextResponse ? config : { run, ...config };
}

/** The first two rungs: a signed-in caller, and a run that exists. */
async function resolveSessionRun(
  id: string,
): Promise<AssemblyRun | NextResponse> {
  if (!(await sessionToken())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const run = await fetchAssemblyRun(id);

  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  return run;
}
