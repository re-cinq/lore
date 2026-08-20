import { NextResponse } from "next/server";
import type { ApiResult } from "@/lib/api/result";

/**
 * Turn a failed lore-api call into this route's response, preserving the
 * upstream status so a proxy answers 404 for a missing task and 409 for a
 * refused transition instead of flattening both to 500.
 *
 * A result with no `code` never reached a server — a refused connection or an
 * unconfigured API — which is this deployment's fault, hence 500.
 */
export function upstreamError(
  action: string,
  result: Exclude<ApiResult<unknown>, { status: "ok" }>,
): NextResponse {
  if (result.status === "unconfigured") {
    return NextResponse.json(
      {
        error: `${action} is unavailable: the web UI has no lore-api configured.`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { error: result.message },
    { status: result.code ?? 500 },
  );
}

/**
 * Status for a proxy response fetched from another Lore service under the
 * web-ui's own credential (the ingest token). That service's 401/403 must not
 * masquerade as the proxy's session (401) / repo-access (403) ladder — the
 * viewer would blame the signed-in user for credential drift — so they
 * surface as 502; every other status passes through verbatim.
 */
export function proxyUpstreamStatus(status: number): number {
  return status === 401 || status === 403 ? 502 : status;
}

/**
 * Logs the full error (stack included) to the server console and returns a 500
 * JSON response carrying just the message. Centralizes 500 handling for API
 * route handlers so every unexpected throw is debuggable in the terminal — the
 * `context` tag identifies which route logged it.
 */
export function serverError(context: string, err: unknown): NextResponse {
  console.error(`[api:${context}]`, err);
  const message = err instanceof Error ? err.message : String(err);

  return NextResponse.json({ error: message }, { status: 500 });
}
