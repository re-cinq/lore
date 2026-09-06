// Unparsed request body, deduped from apps/floor + apps/lore-api (#1051); typed structurally (not hapi's `Request`) so the MCP adapter's lean consumers never need `@hapi/hapi` resolvable (ADR-032).

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

/** The body as BYTES: `rawBody`'s utf-8 decode corrupts binary (e.g. gzip archives) via U+FFFD replacement, so binary routes must use this instead. */
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
