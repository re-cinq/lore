/** Declarative response bodies for the OpenAPI generator (ADR-035). */

import type { RouteOptions } from "@hapi/hapi";
import type { ZodType } from "zod";

/** Error statuses a route declares beyond the universal auth/rate-limit set. */
export type DeclaredErrorStatus = 400 | 401 | 404 | 409;

export interface OpenApiResponseMeta {
  schema: ZodType;
  /** Component name registered in the OpenAPI schema. */
  name: string;
  status: number;
  description: string;
  errors: DeclaredErrorStatus[];
}

export interface ZodResponseOptions {
  name: string;
  status?: number;
  description?: string;
  errors?: DeclaredErrorStatus[];
}

/** Merge a success-response contract onto a route's options. */
export function zodResponse<T extends Pick<RouteOptions, "auth" | "plugins">>(
  base: T,
  schema: ZodType,
  opts: ZodResponseOptions,
): T {
  const meta: OpenApiResponseMeta = {
    schema,
    name: opts.name,
    status: opts.status ?? 200,
    description: opts.description ?? "Successful response",
    errors: opts.errors ?? [],
  };

  return {
    ...base,
    plugins: { ...(base.plugins as Record<string, unknown>), openapi: meta },
  };
}

/** Recover the contract stamped by {@link zodResponse}, or undefined. */
export function getResponseMeta(
  plugins: unknown,
): OpenApiResponseMeta | undefined {
  const entry = (plugins as Record<string, unknown> | undefined)?.["openapi"];

  return entry && typeof entry === "object" && "schema" in entry
    ? (entry as OpenApiResponseMeta)
    : undefined;
}
