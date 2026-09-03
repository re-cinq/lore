/** Reading a request body the services parse themselves (routes set `payload: { parse: false }` for HMAC/any Content-Type); shared so the JSON-parse + schema-validate refusal wording is identical platform-wide. */

import type { z } from "zod";
import { enforceTrue } from "../lib/enforce.js";
import { apiError } from "./api-error.js";

/** Parses a raw body as JSON or refuses with 400; `what` names the thing being parsed so ingresses don't all report a bare "invalid JSON", and V8's own SyntaxError message rides along. */
export function parseJsonBody<T = unknown>(raw: string, what: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw apiError(400)(`invalid JSON in ${what}: ${(err as Error).message}`);
  }
}

/** Parses and validates a raw body against a zod schema, or refuses with 400 naming every failed field (`(body)` when the rejection belongs to no field). */
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
