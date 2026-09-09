import { NextResponse } from "next/server";
import type { ApiResult } from "@/lib/api/result";

/** Preserves the upstream status (404, 409, ...) instead of flattening to 500; a missing `code` means the deployment never reached a server, so it IS a 500. */
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

/** Maps upstream 401/403 (web-ui's own credential) to 502 — otherwise they'd masquerade as the proxy's own session/repo-access ladder; other statuses pass through. */
export function proxyUpstreamStatus(status: number): number {
  return status === 401 || status === 403 ? 502 : status;
}

/** Logs the full error to the server console (context-tagged) and returns a 500 with just the message. */
export function serverError(context: string, err: unknown): NextResponse {
  console.error(`[api:${context}]`, err);
  const message = err instanceof Error ? err.message : String(err);

  return NextResponse.json({ error: message }, { status: 500 });
}
