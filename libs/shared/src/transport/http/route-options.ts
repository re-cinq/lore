/** The hapi route options every app's routes spread instead of restating, so "unauthenticated GET" or "body we parse ourselves" means one thing repo-wide. */

/** Hapi's own auth is off everywhere: each handler's first line is its own bearer guard, which keeps the refusal next to the work it protects. */
export const NO_HAPI_AUTH = { auth: false } as const;

/** A GET the bearer guard still checks in the handler; hapi just does not challenge it. */
export const PUBLIC_GET = { method: "GET", options: NO_HAPI_AUTH } as const;

/** A body this route reads raw — HMAC verification and verbatim forwarding both need the bytes hapi would otherwise have parsed away. */
export const UNPARSED_BODY = {
  auth: false,
  payload: { parse: false },
} as const;

/** `UNPARSED_BODY` with an explicit ceiling: an oversized batch becomes a visible 413 instead of a buffered undeliverable body. */
export function unparsedBodyUpTo(maxBytes: number) {
  return { auth: false, payload: { parse: false, maxBytes } } as const;
}
