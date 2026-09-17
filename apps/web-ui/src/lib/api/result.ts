// Separate from client.ts on purpose: the planning poll runs in the BROWSER and needs this union without dragging `process.env.LORE_ADMIN_TOKEN` into the client bundle.
export type ApiResult<T = unknown> =
  | { status: "ok"; data: T }
  | { status: "unconfigured" }
  /** `code` is the UPSTREAM HTTP status (absent if never reached) — lets a proxy answer 404/409 without coupling to lore-api's exact wording. */
  | { status: "error"; message: string; code?: number; body?: unknown };

/** Response → result; an unparseable body is an empty object, not a throw — a 502 from a proxy is HTML either way. */
export async function toApiResult<T>(res: Response): Promise<ApiResult<T>> {
  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    return {
      status: "error",
      message: (body as { error?: string }).error ?? `HTTP ${res.status}`,
      code: res.status,
      // Whole parsed body — a refusal often says more than its message (e.g. onboard guard names the blocking task).
      body: body,
    };
  }

  return { status: "ok", data: body as T };
}

/**
 * Returns data on success. For a lore-api **refusal** (4xx), returns the
 * formatted error string instead of throwing so a server action can surface it
 * as rendered state rather than a 500. For a **fault** (5xx / unreachable /
 * unconfigured), still throws — those are not the caller's concern to handle.
 */
export function enforceOk<T>(action: string, result: ApiResult<T>): T | string {
  if (result.status === "ok") {
    return result.data;
  }

  const message =
    result.status === "unconfigured"
      ? `${action} is unavailable: the web UI has no LORE_API_URL plus LORE_ADMIN_TOKEN or LORE_INGEST_TOKEN configured.`
      : `${action} failed: ${result.message}`;

  if (
    result.status === "error" &&
    result.code !== undefined &&
    result.code >= 400 &&
    result.code < 500
  ) {
    return message;
  }

  throw new Error(message);
}
