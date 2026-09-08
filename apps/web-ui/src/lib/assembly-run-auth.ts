import { NextResponse } from "next/server";
import { fetchAssemblyRun, type AssemblyRun } from "@/lib/assembly-runs";
import { resolveSessionAccessToken } from "@/lib/session-access-token";
import { type FloorConfig } from "@/lib/floor-config";
import { authorizeRepoFloorAccess } from "@/lib/floor-access";
import { serverError } from "@/lib/api-error";

export interface AssemblyRunAuth {
  run: AssemblyRun;
  floorUrl: string;
  token: string;
}

/** Type guard narrowing an {@link authorizeAssemblyRunAccess} result to the error response. */
export function isAssemblyRunAuthError(
  result: AssemblyRunAuth | NextResponse,
): result is NextResponse {
  return result instanceof NextResponse;
}

/** Session → run → repo-access → Floor-env ladder shared by every run proxy route (events/turns/stream/node-logs). */
export async function authorizeAssemblyRunAccess(
  id: string,
): Promise<AssemblyRunAuth | NextResponse> {
  const accessToken = await resolveSessionAccessToken();

  if (!accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const run = await fetchAssemblyRun(id);

  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const floorConfig = await authorizeRepoFloorAccess(accessToken, run.repo);

  if (floorConfig instanceof NextResponse) {
    return floorConfig;
  }

  return { run, ...floorConfig };
}

/** What a run proxy needs once the ladder has passed: the run id, the caller's request, and the Floor to ask. */
export interface RunProxyContext extends FloorConfig {
  id: string;
  req: Request;
}

/** A run-scoped Floor proxy route. The id, the auth ladder and the failure label are the same for every one of them, so each route states only its upstream call. */
export function assemblyRunProxyRoute(
  errorContext: string,
  proxy: (ctx: RunProxyContext) => Promise<Response>,
) {
  return async function GET(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
  ) {
    const { id } = await params;

    try {
      return await proxyAuthorizedRun(id, req, proxy);
    } catch (err) {
      return serverError(errorContext, err);
    }
  };
}

/** Runs the ladder and hands the proxy what it needs, or returns the ladder's own refusal untouched. */
async function proxyAuthorizedRun(
  id: string,
  req: Request,
  proxy: (ctx: RunProxyContext) => Promise<Response>,
): Promise<Response> {
  const auth = await authorizeAssemblyRunAccess(id);

  if (isAssemblyRunAuthError(auth)) {
    return auth;
  }

  return proxy({ id, req, floorUrl: auth.floorUrl, token: auth.token });
}
