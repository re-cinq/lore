/**
 * Declarative response bodies for the OpenAPI generator (ADR-035).
 *
 * The mirror of `zodValidate` on the way out: it stamps a route's success schema
 * onto `options.plugins.openapi`, and the generator recovers it — exactly how
 * `bearerScope` stamps `plugins["bearer-scope"].scope`.
 *
 * It MERGES onto a base options object rather than returning a standalone one.
 * `bearerScope()` already owns `options.plugins`, so spreading two producers
 * (`{ ...bearerScope("read"), ...zodResponse(S) }`) would silently clobber the
 * bearer-scope key and drop the auth scope off every route it touched. Taking the
 * base as an argument makes that impossible to write.
 *
 * Documentation only. hapi's own `options.response.schema` would VALIDATE
 * responses at runtime, and a doc comment that can 500 a working endpoint is worse
 * than no doc.
 */

import type { RouteOptions } from "@hapi/hapi";
import type { ZodType } from "zod";

/** Error statuses a route declares beyond the universal auth/rate-limit set. */
export type DeclaredErrorStatus = 400 | 404 | 409;

export interface OpenApiResponseMeta {
  schema: ZodType;
  /** Component name. The generator registers it under `components.schemas`, so
   *  codegen emits one NAMED type rather than an anonymous inline one. */
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
