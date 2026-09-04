/** Shapes an operation's request body and response envelope (ADR-035): the Zod-derived contract half of the document. */

import type { ServerRoute, RouteOptions } from "@hapi/hapi";
import type { ZodType } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { getZodSchema } from "../server/plugins/zod-validate.js";
import {
  getResponseMeta,
  type OpenApiResponseMeta,
} from "../server/plugins/zod-response.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { BODYLESS_WRITES, domainBody } from "./domain-routes.js";

export type JsonSchema = Record<string, unknown>;

/** Per-route coverage classification — consumed by the drift-guard test and logged. */
export interface Coverage {
  covered: string[];
  lifted: string[];
  freeform: string[];
  selfHandled: string[];
  bodyless: string[];
  uncovered: string[];
  excluded: string[];
  responses: string[];
  responsesMissing: string[];
}

/** hapi route options are always object-form in this codebase. */
export const optionsOf = (route: ServerRoute): RouteOptions =>
  (typeof route.options === "object" && route.options
    ? route.options
    : {}) as RouteOptions;

/** A route with `payload.parse === false` self-handles its body (webhooks: HMAC/form). */
function selfHandlesBody(route: ServerRoute): boolean {
  const payload = optionsOf(route).payload as { parse?: boolean } | undefined;

  return payload?.parse === false;
}

/** Parse:false route with real API surface (NDJSON) declared via options.app.rawBody; not webhook. */
interface RawBodyMeta {
  contentType: string;
  description: string;
}

function rawBodyOf(route: ServerRoute): RawBodyMeta | undefined {
  const app = optionsOf(route).app as { rawBody?: RawBodyMeta } | undefined;

  return app?.rawBody;
}

/** The zod payload schema stamped by `zodValidate`, if this route declares one. */
function routeSchema(route: ServerRoute): ZodType | undefined {
  const validate = optionsOf(route).validate as
    { payload?: unknown } | undefined;

  return getZodSchema(validate?.payload);
}

const FREEFORM_BODY: JsonSchema = {
  type: "object",
  additionalProperties: true,
};

const jsonBody = (schema: JsonSchema): JsonSchema => ({
  required: true,
  content: { "application/json": { schema } },
});

/** zod → JSON Schema for embedding in a requestBody; draft-7 output, `$schema` stripped. */
export function toRequestSchema(schema: ZodType): JsonSchema {
  const out = zodToJsonSchema(schema, {
    $refStrategy: "none",
    target: "jsonSchema7",
  }) as JsonSchema;

  delete out.$schema;

  return out;
}

function successResponse(success?: {
  meta: OpenApiResponseMeta;
  ref: JsonSchema;
}): Record<string, JsonSchema> {
  // Declared contract replaces generic 200 (not joins); two status types = union-to-unknown.
  return success
    ? {
        [String(success.meta.status)]: {
          description: success.meta.description,
          content: { "application/json": { schema: success.ref } },
        },
      }
    : {
        "200": {
          description:
            "Successful response (2xx; the response body is not described — see info.description)",
        },
      };
}

// 401 here covers auth:false routes that hand-authenticate (pre-shared token).
const DECLARABLE_ERRORS: Array<{ status: number; ref: string }> = [
  { status: 401, ref: "Unauthorized" },
  { status: 404, ref: "NotFound" },
  { status: 409, ref: "Conflict" },
];

function declaredErrorResponses(
  declared: Set<number>,
): Record<string, JsonSchema> {
  const responses: Record<string, JsonSchema> = {};

  for (const { status, ref } of DECLARABLE_ERRORS) {
    if (declared.has(status)) {
      responses[String(status)] = { $ref: `#/components/responses/${ref}` };
    }
  }

  return responses;
}

const PRIVATE_OP_RESPONSES: Record<string, JsonSchema> = {
  "401": { $ref: "#/components/responses/Unauthorized" },
  "403": { $ref: "#/components/responses/Forbidden" },
  "503": { $ref: "#/components/responses/ServiceUnavailable" },
};

function bodyResponses(
  hasBody: boolean,
  declared: Set<number>,
): Record<string, JsonSchema> {
  const responses: Record<string, JsonSchema> = {};

  if (hasBody || declared.has(400)) {
    responses["400"] = { $ref: "#/components/responses/BadRequest" };
  }

  if (hasBody) {
    responses["413"] = { $ref: "#/components/responses/PayloadTooLarge" };
  }

  return responses;
}

export function responsesFor(
  isPublicOp: boolean,
  hasBody: boolean,
  success?: { meta: OpenApiResponseMeta; ref: JsonSchema },
): Record<string, JsonSchema> {
  const declared = new Set<number>(success?.meta.errors ?? []);

  return {
    ...successResponse(success),
    ...declaredErrorResponses(declared),
    ...bodyResponses(hasBody, declared),
    ...(isPublicOp ? {} : PRIVATE_OP_RESPONSES),
    "429": { $ref: "#/components/responses/RateLimited" },
  };
}

/** Resolve + classify a write route's request body; records coverage as a side effect. */
function resolveBody(
  route: ServerRoute,
  method: string,
  key: string,
  coverage: Coverage,
): JsonSchema | undefined {
  const declared = routeSchema(route);

  if (declared) {
    coverage.covered.push(key);

    return jsonBody(toRequestSchema(declared));
  }
  const domain = domainBody(method, route.path);

  if (domain?.schema) {
    coverage.lifted.push(key);

    return jsonBody(toRequestSchema(domain.schema));
  }

  if (domain?.freeform) {
    coverage.freeform.push(key);

    return jsonBody(FREEFORM_BODY);
  }
  // No route schema and no sidecar entry: still emit a valid doc, but flag drift.
  coverage.uncovered.push(key);

  return jsonBody(FREEFORM_BODY);
}

/** Register response as named component; duplicate with different shape is hard error. */
export function registerResponse(
  route: ServerRoute,
  key: string,
  schemas: Record<string, JsonSchema>,
  coverage: Coverage,
): { meta: OpenApiResponseMeta; ref: JsonSchema } | undefined {
  const meta = getResponseMeta(optionsOf(route).plugins);

  if (!meta) {
    coverage.responsesMissing.push(key);

    return undefined;
  }
  const converted = toRequestSchema(meta.schema);
  const existing = schemas[meta.name];

  enforceTrue(
    existing === undefined ||
      JSON.stringify(existing) === JSON.stringify(converted),
    Error,
    `openapi: response schema "${meta.name}" is registered with two different shapes (at ${key})`,
  );
  schemas[meta.name] = converted;
  coverage.responses.push(key);

  return { meta, ref: { $ref: `#/components/schemas/${meta.name}` } };
}

/** Self-handled body: handler verifies it, not JSON parsing; publish declared shape or note. */
function applySelfHandledBody(
  op: { description?: string; requestBody?: JsonSchema },
  route: ServerRoute,
): void {
  const raw = rawBodyOf(route);

  if (!raw) {
    op.description =
      "Request body is verified and parsed by the handler (HMAC/form-encoded), not JSON.";

    return;
  }
  op.description = raw.description;
  op.requestBody = {
    required: true,
    content: { [raw.contentType]: { schema: { type: "string" } } },
  };
}

/** Classify write route body: self-handled, bodyless, or Zod-derived; record coverage. */
export function applyRequestBody(
  op: { description?: string; requestBody?: JsonSchema },
  route: ServerRoute,
  method: string,
  coverage: Coverage,
): void {
  const key = `${method} ${route.path}`;

  if (selfHandlesBody(route)) {
    coverage.selfHandled.push(key);
    applySelfHandledBody(op, route);

    return;
  }

  if (BODYLESS_WRITES.has(key)) {
    coverage.bodyless.push(key);

    return;
  }
  op.requestBody = resolveBody(route, method, key, coverage);
}

export function errorResponses(): Record<string, JsonSchema> {
  const body = {
    content: {
      "application/json": { schema: { $ref: "#/components/schemas/Error" } },
    },
  };

  return {
    BadRequest: { description: "Malformed or invalid request", ...body },
    NotFound: { description: "No such resource", ...body },
    Conflict: {
      description: "Not allowed in the resource's current state",
      ...body,
    },
    Unauthorized: { description: "Missing bearer token", ...body },
    Forbidden: { description: "Token lacks the required scope", ...body },
    PayloadTooLarge: {
      description: "Request body exceeds the size cap",
      ...body,
    },
    RateLimited: {
      description: "Rate limit exceeded (Retry-After: 60)",
      ...body,
    },
    ServiceUnavailable: {
      description: "Database or a dependency is unavailable",
      ...body,
    },
  };
}
