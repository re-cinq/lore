/** zod ↔ hapi request validation (ADR-034). */

import { apiError } from "../api-error.js";
import type { Request, ResponseToolkit } from "@hapi/hapi";
import type { ZodError, ZodType } from "zod";

/** A single `{ error }` message naming the first offending field where zod has one. */
export function formatZodError(error: ZodError): string {
  const [issue] = error.issues;

  if (!issue) {
    return "invalid request";
  }
  const path = issue.path.join(".");

  return path ? `${path}: ${issue.message}` : issue.message;
}

/** A hapi validation function carrying the zod schema (ADR-035). */
export type ZodValidateFn<T> = ((value: unknown) => Promise<T>) & {
  zodSchema: ZodType<T>;
};

/** Adapt a zod schema to a hapi validation function (payload/query/params). */
export function zodValidate<T>(schema: ZodType<T>): ZodValidateFn<T> {
  const validate = async (value: unknown): Promise<T> => {
    const result = schema.safeParse(value);

    if (result.success) {
      return result.data;
    }
    throw new Error(formatZodError(result.error));
  };

  return Object.assign(validate, { zodSchema: schema });
}

/** Recover the zod schema stamped by `zodValidate`, or undefined for any other validator. */
export function getZodSchema(validator: unknown): ZodType | undefined {
  return typeof validator === "function" && "zodSchema" in validator
    ? (validator as ZodValidateFn<unknown>).zodSchema
    : undefined;
}

/** Server-level validation failAction: reshape any validation error to `{ error }` 400. */
export function zodFailAction(
  _request: Request,
  _h: ResponseToolkit,
  err?: Error,
): never {
  throw apiError(400)(err?.message ?? "invalid request");
}
