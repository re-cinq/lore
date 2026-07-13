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
 * Parse a raw request body as JSON, or throw a 400 (`Boom.badRequest`). Routes
 * set `payload.parse = false` and parse the body themselves so it works
 * regardless of the request's Content-Type.
 */
export function parseJsonBody<T = unknown>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw Boom.badRequest("invalid JSON");
  }
}
