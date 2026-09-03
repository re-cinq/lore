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

/** Throws when the result did not succeed — an ignored `ApiResult` return would swallow every 4xx/5xx as a silent no-op refresh. Local, not `enforceTrue` from @re-cinq/lore-shared: web-ui isn't an npm workspace member. */
export function enforceOk<T>(action: string, result: ApiResult<T>): T {
  if (result.status === "ok") {
    return result.data;
  }

  throw new Error(
    result.status === "unconfigured"
      ? `${action} is unavailable: the web UI has no LORE_API_URL plus LORE_ADMIN_TOKEN or LORE_INGEST_TOKEN configured.`
      : `${action} failed: ${result.message}`,
  );
}
