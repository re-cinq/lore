/**
 * zod ↔ hapi request validation (ADR-034). `zodValidate(schema)` adapts a zod
 * schema into hapi's `options.validate.{payload,query,params}` function form: it
 * parses the value, returns the typed/coerced result (which hapi assigns back to
 * `request.payload`/`.query`/`.params`), and throws on failure. A single
 * server-level `zodFailAction` (registered in `build-server.ts`) shapes every
 * validation failure into the routes' `{ error: <message> }` 400 body — the same
 * envelope `bearer-scope.ts` produces — so no route emits hapi's default
 * `{ statusCode, error, message }` shape.
 */

import Boom from "@hapi/boom";
import type { Request, ResponseToolkit } from "@hapi/hapi";
import type { ZodError, ZodType } from "zod";

/** A single `{ error }` message naming the first offending field where zod has one. */
export function formatZodError(error: ZodError): string {
  const [issue] = error.issues;
  if (!issue) return "invalid request";
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

/** Adapt a zod schema to a hapi validation function (payload/query/params). */
export function zodValidate<T>(schema: ZodType<T>) {
  return async (value: unknown): Promise<T> => {
    const result = schema.safeParse(value);
    if (result.success) return result.data;
    throw new Error(formatZodError(result.error));
  };
}

/** Server-level validation failAction: reshape any validation error to `{ error }` 400. */
export function zodFailAction(_request: Request, _h: ResponseToolkit, err?: Error): never {
  const message = err?.message ?? "invalid request";
  const boom = Boom.badRequest(message);
  boom.output.payload = { error: message } as unknown as Boom.Payload;
  throw boom;
}
