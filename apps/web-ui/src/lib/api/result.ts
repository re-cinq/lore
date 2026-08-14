// The shape every Lore API call answers with, and the two ways to consume it.
//
// Deliberately SEPARATE from client.ts: the planning poll runs in the BROWSER and
// needs this union and this 4xx→message mapping, but must not drag
// `process.env.LORE_ADMIN_TOKEN` access into the client bundle. Nothing here
// touches process.env or knows a service exists.

export type ApiResult<T = unknown> =
  | { status: "ok"; data: T }
  | { status: "unconfigured" }
  /** `code` is the UPSTREAM HTTP status, absent when the call never reached a
   *  server. A proxy route needs it to answer 404 for a missing task and 409 for
   *  a refused transition — matching on the message text instead would couple
   *  every proxy to lore-api's exact wording. */
  | { status: "error"; message: string; code?: number };

/** Response → result. An unparseable body is an empty object, not a throw: a 502
 *  from a proxy is HTML, and the status code is the news either way. */
export async function toApiResult<T>(res: Response): Promise<ApiResult<T>> {
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    return {
      status: "error",
      message: (data as { error?: string }).error ?? `HTTP ${res.status}`,
      code: res.status,
    };
  }

  return { status: "ok", data: data as T };
}

/**
 * Unwrap a result, throwing when it did not succeed.
 *
 * `toApiResult` reports failure in its RETURN VALUE — it catches transport errors
 * too — so a server action that ignores the return swallows every 4xx/5xx, an
 * unconfigured API URL and a refused connection alike. That action resolves
 * normally: the browser is told 200, nothing was written, and the failure is
 * indistinguishable from a no-op refresh. Next surfaces a THROWN action error to
 * the client, so enforcing here is what puts the real message on screen.
 *
 * Local rather than `enforceTrue` from @re-cinq/lore-shared, which web-ui cannot
 * import — it is not an npm workspace member.
 */
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
