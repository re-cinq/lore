/**
 * Raw request body as a string. Routes that need the unparsed bytes (HMAC
 * verification, NDJSON, parse-anything-as-JSON) set `options.payload.parse =
 * false`, so hapi delivers `request.payload` as a Buffer — this normalizes it.
 * Replaces the four hand-rolled `readBody()` copies of the old node:http server.
 */

import Boom from "@hapi/boom";
import type { Request } from "@hapi/hapi";

export function rawBody(request: Request): string {
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
 * Raw request body as BYTES, for content that is not text — an agent conversation
 * archive is gzip, and `rawBody`'s utf-8 decode replaces every invalid sequence with
 * U+FFFD, silently corrupting it. Routes handling binary must use this instead.
 */
export function rawBytes(request: Request): Buffer {
  const payload = request.payload;

  if (Buffer.isBuffer(payload)) {
    return payload;
  }

  if (typeof payload === "string") {
    return Buffer.from(payload, "utf8");
  }

  return Buffer.alloc(0);
}

/**
 * Parse a raw request body as JSON, or throw a 400 (`Boom.badRequest`). Routes
 * set `payload.parse = false` and parse the body themselves so it works
 * regardless of the request's Content-Type.
 */
export function parseJsonBody<T = unknown>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    // TODO: we must say where the invalid json is coming from. We can add a parameter to this function that will be the name of the route that is calling it. This way we can have a more actionable error message. Also, we need to tell the client where the error is in the request body.
    throw Boom.badRequest("invalid JSON");
  }
}
