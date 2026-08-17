// The unparsed request body, shared by the two hapi servers (#1051).
//
// `rawBody` was byte-identical in `apps/floor` and `apps/lore-api`. Routes that
// need the bytes as sent — HMAC verification, NDJSON, parse-anything-as-JSON —
// set `payload: { parse: false }`, so hapi hands back a Buffer; this normalizes
// it to a string.
//
// The parameter is typed STRUCTURALLY rather than as hapi's `Request`. Neither
// this package nor its lean consumers depend on hapi, and a type-only import
// would still make `@hapi/hapi` resolvable-or-bust for everyone who typechecks
// against these declarations — including the MCP adapter, whose whole point is
// not to carry the servers' dependencies (ADR-032). `{ payload?: unknown }` is
// also an honest statement of what the function reads.

/** Anything with a hapi-shaped payload — `Request` satisfies this. */
export interface WithPayload {
  payload?: unknown;
}

/** The request body as a string; empty when there is nothing to read. */
export function rawBody(request: WithPayload): string {
  const payload = request.payload;

  if (Buffer.isBuffer(payload)) {
    return payload.toString("utf8");
  }

  if (typeof payload === "string") {
    return payload;
  }

  return "";
}

/**
 * The body as BYTES, for content that is not text.
 *
 * An agent conversation archive is gzip, and `rawBody`'s utf-8 decode replaces
 * every invalid sequence with U+FFFD — silently corrupting it. Routes handling
 * binary must use this instead.
 */
export function rawBytes(request: WithPayload): Buffer {
  const payload = request.payload;

  if (Buffer.isBuffer(payload)) {
    return payload;
  }

  if (typeof payload === "string") {
    return Buffer.from(payload, "utf8");
  }

  return Buffer.alloc(0);
}
