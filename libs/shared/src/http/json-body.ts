/**
 * Reading a request body the services parse themselves.
 *
 * Routes that need the bytes as sent set `payload: { parse: false }` — for HMAC
 * verification, or simply to accept a body whatever its Content-Type. They then
 * all need the same two things: turn the raw string into JSON, and validate it
 * against a schema, refusing with a reason a reader can act on.
 *
 * Both were written out per service. Sharing them keeps the refusal wording
 * identical across the platform, which is what makes a 400 legible when it
 * arrives in someone else's log.
 */

import type { z } from "zod";
import { enforceTrue } from "../lib/enforce.js";
import { apiError } from "./api-error.js";

/**
 * Parse a raw body as JSON, or refuse with 400.
 *
 * `what` names the thing being parsed, so five ingresses that all parse bodies
 * do not all report a bare "invalid JSON". The parser's own complaint rides
 * along: V8 names the offending position, which beats anything re-derived here.
 *
 * There is no non-Error branch because `JSON.parse` rejects only with
 * SyntaxError — a guard for one would be a branch no test could reach.
 */
export function parseJsonBody<T = unknown>(raw: string, what: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw apiError(400)(`invalid JSON in ${what}: ${(err as Error).message}`);
  }
}

/**
 * Parse and validate a raw body against a zod schema, or refuse with 400 naming
 * every field that failed — `(body)` for a rejection that belongs to no field,
 * so a payload that is not even an object still says so.
 */
export function parseBody<T>(
  raw: string,
  schema: z.ZodType<T>,
  what: string,
): T {
  const parsed = schema.safeParse(parseJsonBody(raw, what));

  enforceTrue(
    parsed.success,
    apiError(400),
    `not a ${what}: ${parsed.error?.issues
      .map((i) => `${i.path.join(".") || "(body)"} ${i.message}`)
      .join("; ")}`,
  );

  return parsed.data;
}
