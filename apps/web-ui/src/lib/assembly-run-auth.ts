import { NextResponse } from "next/server";
import { fetchAssemblyRun, type AssemblyRun } from "@/lib/assembly-runs";
import { resolveSessionAccessToken } from "@/lib/session-access-token";
import type { RunUpstream, UpstreamConfig } from "@/lib/floor-config";
import { authorizeRepoUpstreamAccess } from "@/lib/floor-access";
import { serverError } from "@/lib/api-error";

export interface AssemblyRunAuth extends UpstreamConfig {
  run: AssemblyRun;
}

/** Type guard narrowing an {@link authorizeAssemblyRunAccess} result to the error response. */
export function isAssemblyRunAuthError(
  result: AssemblyRunAuth | NextResponse,
): result is NextResponse {
  return result instanceof NextResponse;
}

/** Session → run → repo-access → upstream-env ladder shared by every run proxy route (events/turns/node-logs on the Floor, the stream on lore-api). */
export async function authorizeAssemblyRunAccess(
  id: string,
  upstream: RunUpstream = "floor",
): Promise<AssemblyRunAuth | NextResponse> {
  const session = await resolveSessionRun(id);

  if (session instanceof NextResponse) {
    return session;
  }
  const config = await authorizeRepoUpstreamAccess(
    session.accessToken,
    session.run.repo,
    upstream,
  );

  return config instanceof NextResponse
    ? config
    : { run: session.run, ...config };
}

/** The first two rungs: a signed-in caller, and a run that exists. */
async function resolveSessionRun(
  id: string,
): Promise<{ accessToken: string; run: AssemblyRun } | NextResponse> {
  const accessToken = await resolveSessionAccessToken();

  if (!accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const run = await fetchAssemblyRun(id);

  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  return { accessToken, run };
}

/** What a run proxy needs once the ladder has passed: the run id, the run the ladder resolved, the caller's request, and the upstream to ask. */
export interface RunProxyContext extends UpstreamConfig {
  id: string;
  run: AssemblyRun;
  req: Request;
}

/** A run-scoped proxy route. The id, the auth ladder and the failure label are the same for every one of them, so each route states only its upstream call and which backend answers it. */
export function assemblyRunProxyRoute(
  errorContext: string,
  proxy: (ctx: RunProxyContext) => Promise<Response>,
  upstream: RunUpstream = "floor",
) {
  return async function GET(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
  ) {
    const { id } = await params;

    try {
      return await proxyAuthorizedRun(id, req, proxy, upstream);
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
  upstream: RunUpstream,
): Promise<Response> {
  const auth = await authorizeAssemblyRunAccess(id, upstream);

  if (isAssemblyRunAuthError(auth)) {
    return auth;
  }

  return proxy({
    id,
    run: auth.run,
    req,
    upstreamUrl: auth.upstreamUrl,
    token: auth.token,
  });
}
