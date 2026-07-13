/**
 * OpenAPI 3.1 document generation (ADR-035). Walks the shared `routeList` — the
 * one source of truth for the API surface — and projects each route into an
 * operation: path + params, required scope, rate-limit bucket, request body
 * (converted zod schema for covered routes; lifted domain schema or freeform for
 * the domain-validated ones), and the shared error envelope.
 *
 * The document is request-focused: request contracts and the `{ error }` envelope
 * are declared, so they are described precisely; success bodies are not declared,
 * so they are described generically. Stated in `info.description`.
 */

import type { ServerRoute, RouteOptions } from "@hapi/hapi";
import type { ZodType } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { getZodSchema } from "../server/plugins/zod-validate.js";
import { bucketFor } from "../server/plugins/rate-limit.js";
import {
  WILDCARD_METHODS,
  BODYLESS_WRITES,
  domainBody,
} from "./domain-routes.js";

type JsonSchema = Record<string, unknown>;

interface Operation {
  operationId: string;
  summary: string;
  tags: string[];
  description?: string;
  parameters?: JsonSchema[];
  requestBody?: JsonSchema;
  security: Array<Record<string, string[]>>;
  responses: Record<string, JsonSchema>;
  "x-required-scope"?: string;
  "x-rate-limit-bucket": string;
}

export interface OpenApiDocument {
  openapi: "3.1.0";
  info: { title: string; version: string; description: string };
  servers?: Array<{ url: string }>;
  tags: Array<{ name: string; description: string }>;
  paths: Record<string, Record<string, Operation>>;
  components: {
    securitySchemes: Record<string, JsonSchema>;
    schemas: Record<string, JsonSchema>;
    responses: Record<string, JsonSchema>;
  };
}

/** Per-route coverage classification — consumed by the drift-guard test and logged. */
export interface Coverage {
  covered: string[]; // "METHOD path" validated by a route-level zodValidate schema
  lifted: string[]; // documented via a domain schema referenced in the sidecar
  freeform: string[]; // documented as a permissive object (known, allowlisted)
  selfHandled: string[]; // parse:false — the handler owns its (HMAC/form) body
  bodyless: string[]; // write route that legitimately carries no request body
  uncovered: string[]; // write method with neither a schema nor a sidecar entry — drift
  excluded: string[]; // operational non-API paths
}

/** A route with `payload.parse === false` self-handles its body (webhooks: HMAC/form). */
function selfHandlesBody(route: ServerRoute): boolean {
  const payload = optionsOf(route).payload as { parse?: boolean } | undefined;

  return payload?.parse === false;
}

export interface GenerateOptions {
  version?: string;
  serverUrl?: string;
}

const API_TITLE = "Lore API";
const DEFAULT_VERSION = "0.1.0";
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH"]);
const FREEFORM_BODY: JsonSchema = {
  type: "object",
  additionalProperties: true,
};

const isExcludedPath = (path: string): boolean =>
  path === "/healthz" || path.startsWith("/dist/");

/** hapi route options are always object-form in this codebase. */
const optionsOf = (route: ServerRoute): RouteOptions =>
  (typeof route.options === "object" && route.options
    ? route.options
    : {}) as RouteOptions;

const isPublic = (route: ServerRoute): boolean =>
  optionsOf(route).auth === false;

function scopeOf(route: ServerRoute): string | undefined {
  const plugins = optionsOf(route).plugins as
    Record<string, { scope?: string } | undefined> | undefined;

  return plugins?.["bearer-scope"]?.scope;
}

/** The zod payload schema stamped by `zodValidate`, if this route declares one. */
function routeSchema(route: ServerRoute): ZodType | undefined {
  const validate = optionsOf(route).validate as
    { payload?: unknown } | undefined;

  return getZodSchema(validate?.payload);
}

/** Concrete verbs for a route — expanding `method: "*"` via the sidecar. */
function methodsOf(route: ServerRoute): string[] {
  const method = Array.isArray(route.method) ? route.method : [route.method];

  if (method.includes("*")) {
    return WILDCARD_METHODS[route.path] ?? [];
  }

  return method.map((m) => m.toUpperCase());
}

/** `{owner}` / `{name?}` / `{artifact*}` → OpenAPI `{owner}`; strip optional/wildcard markers. */
export function normalizePath(hapiPath: string): string {
  return hapiPath.replace(/\{(\w+)[?*]\}/g, "{$1}");
}

/**
 * Sidebar categories in display order — Redoc renders groups in the order of the
 * document's root `tags` array. Each operation is tagged by its path via `tagFor`;
 * the drift guard asserts every operation lands in a real category (never the
 * `UNCATEGORIZED` fallback), so a new route surfaces as an untagged failure.
 */
const CATEGORY_ORDER: Array<{ name: string; description: string }> = [
  { name: "Context", description: "Context assembly and the knowledge graph." },
  {
    name: "Memory",
    description: "Agent memory: entries, episodes, and session summaries.",
  },
  {
    name: "Tasks",
    description: "Pipeline task lifecycle, timelines, and logs.",
  },
  {
    name: "Repositories",
    description: "Onboarded repositories and their status.",
  },
  { name: "Features", description: "Feature-planning iterations." },
  { name: "Agents", description: "Per-repo agent definitions." },
  { name: "Ingestion", description: "Content and graph ingestion." },
  {
    name: "Traceability",
    description: "Spec-traceability queries and change impact.",
  },
  {
    name: "Dark Factory",
    description: "Autonomous-mode (dark factory) settings.",
  },
  {
    name: "Webhooks",
    description: "Inbound webhooks and per-repo webhook configuration.",
  },
  { name: "Tokens", description: "Scoped API token management." },
  { name: "Meta", description: "The OpenAPI document and its reference UI." },
];

const UNCATEGORIZED = "Other";

/** Path→category rules, first match wins; ordered specific → general. */
const TAG_RULES: Array<[RegExp, string]> = [
  [/^\/api\/(openapi\.json|docs)$/, "Meta"],
  [/^\/api\/(context|graph)\b/, "Context"],
  [/^\/api\/(memory|episode|session-summary)\b/, "Memory"],
  [/^\/api\/(task|tasks|task-logs|job-run-logs)\b/, "Tasks"],
  [/\/features\b/, "Features"],
  [/\/agent-definitions\b/, "Agents"],
  [/\/settings\/dark-factory\b/, "Dark Factory"],
  [/\/(trace|impact)\b/, "Traceability"],
  [/\/ingest/, "Ingestion"],
  [/\/webhook/, "Webhooks"],
  [/^\/api\/tokens\b/, "Tokens"],
  [/^\/api\/(repos|repo-status|pr-status|onboard)\b/, "Repositories"],
];

/** The sidebar category for a normalized path. */
export function tagFor(normPath: string): string {
  for (const [re, tag] of TAG_RULES) {
    if (re.test(normPath)) {
      return tag;
    }
  }

  return UNCATEGORIZED;
}

function pathParameters(hapiPath: string): {
  params: JsonSchema[];
  hasOptional: boolean;
} {
  const params: JsonSchema[] = [];
  let hasOptional = false;

  for (const match of hapiPath.matchAll(/\{(\w+)([?*]?)\}/g)) {
    const [, name, marker] = match;

    if (marker) {
      hasOptional = true;
    }
    params.push({
      name,
      in: "path",
      required: true,
      schema: { type: "string" },
    });
  }

  return { params, hasOptional };
}

/** zod → JSON Schema for embedding in a requestBody; draft-7 output, `$schema` stripped. */
export function toRequestSchema(schema: ZodType): JsonSchema {
  const out = zodToJsonSchema(schema, {
    $refStrategy: "none",
    target: "jsonSchema7",
  }) as JsonSchema;

  delete out.$schema;

  return out;
}

const jsonBody = (schema: JsonSchema): JsonSchema => ({
  required: true,
  content: { "application/json": { schema } },
});

function operationId(method: string, normPath: string): string {
  const slug = normPath
    .replace(/^\/+/, "")
    .replace(/[/{}]/g, "_")
    .replace(/_+/g, "_")
    .replace(/_$/, "");

  return `${method.toLowerCase()}_${slug}`;
}

function responsesFor(
  isPublicOp: boolean,
  hasBody: boolean,
): Record<string, JsonSchema> {
  const responses: Record<string, JsonSchema> = {
    "200": {
      description:
        "Successful response (2xx; the response body is not described — see info.description)",
    },
  };

  if (hasBody) {
    responses["400"] = { $ref: "#/components/responses/BadRequest" };
  }

  if (!isPublicOp) {
    responses["401"] = { $ref: "#/components/responses/Unauthorized" };
    responses["403"] = { $ref: "#/components/responses/Forbidden" };
    responses["503"] = { $ref: "#/components/responses/ServiceUnavailable" };
  }

  if (hasBody) {
    responses["413"] = { $ref: "#/components/responses/PayloadTooLarge" };
  }
  responses["429"] = { $ref: "#/components/responses/RateLimited" };

  return responses;
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

function buildOperation(
  route: ServerRoute,
  method: string,
  normPath: string,
  coverage: Coverage,
): Operation {
  const { params, hasOptional } = pathParameters(route.path);
  const publicOp = isPublic(route);
  const scope = scopeOf(route);
  const hasBody = WRITE_METHODS.has(method);
  const op: Operation = {
    operationId: operationId(method, normPath),
    summary: `${method} ${normPath}`,
    tags: [tagFor(normPath)],
    security: publicOp ? [] : [{ bearerAuth: [] }],
    "x-rate-limit-bucket": bucketFor(route.path),
    responses: responsesFor(publicOp, hasBody),
  };

  if (scope) {
    op["x-required-scope"] = scope;
  }

  if (params.length) {
    op.parameters = params;
  }

  if (hasOptional) {
    op.description =
      "A trailing path parameter is optional; omit it for the collection form.";
  }

  if (hasBody) {
    const key = `${method} ${route.path}`;

    if (selfHandlesBody(route)) {
      coverage.selfHandled.push(key);
      op.description =
        "Request body is verified and parsed by the handler (HMAC/form-encoded), not JSON.";
    } else if (BODYLESS_WRITES.has(key)) {
      coverage.bodyless.push(key);
    } else {
      op.requestBody = resolveBody(route, method, key, coverage);
    }
  }

  return op;
}

/** Generate the OpenAPI document plus the per-route coverage classification. */
export function generateOpenApi(
  routes: ServerRoute[],
  opts: GenerateOptions = {},
): { document: OpenApiDocument; coverage: Coverage } {
  const paths: Record<string, Record<string, Operation>> = {};
  const coverage: Coverage = {
    covered: [],
    lifted: [],
    freeform: [],
    selfHandled: [],
    bodyless: [],
    uncovered: [],
    excluded: [],
  };

  for (const route of routes) {
    if (isExcludedPath(route.path)) {
      coverage.excluded.push(route.path);
      continue;
    }
    const normPath = normalizePath(route.path);

    for (const method of methodsOf(route)) {
      const operation = buildOperation(route, method, normPath, coverage);

      (paths[normPath] ??= {})[method.toLowerCase()] = operation;
    }
  }

  const usedTags = new Set<string>();

  for (const item of Object.values(paths)) {
    for (const op of Object.values(item)) {
      usedTags.add(op.tags[0]);
    }
  }

  const document: OpenApiDocument = {
    openapi: "3.1.0",
    info: {
      title: API_TITLE,
      version: opts.version ?? DEFAULT_VERSION,
      description:
        "Generated from the lore-api hapi route zod schemas (ADR-035). This document " +
        "describes request contracts and the uniform `{ error }` error envelope precisely; " +
        "success response bodies are not declaratively described and appear generically. " +
        "Per-route required scope is the `x-required-scope` extension (HTTP bearer has no " +
        "scope list); the rate-limit bucket is `x-rate-limit-bucket`.",
    },
    // Always present (OpenAPI requires a non-empty servers list); defaults to the
    // relative same-origin `/` when LORE_API_URL is unset.
    servers: [{ url: opts.serverUrl ?? "/" }],
    // Only categories actually in use, in canonical sidebar order.
    tags: CATEGORY_ORDER.filter((c) => usedTags.has(c.name)),
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
      schemas: {
        Error: {
          type: "object",
          properties: { error: { type: "string" } },
          required: ["error"],
        },
      },
      responses: errorResponses(),
    },
  };

  return { document, coverage };
}

/** The document only (convenience for the serving route). */
export function buildOpenApiDocument(
  routes: ServerRoute[],
  opts?: GenerateOptions,
): OpenApiDocument {
  return generateOpenApi(routes, opts).document;
}

/** One-line coverage summary for a boot-time log — FR7 (uncovered/excluded not silent). */
export function summarizeCoverage(c: Coverage): string {
  return (
    `[openapi] write bodies — covered:${c.covered.length} lifted:${c.lifted.length} ` +
    `freeform:${c.freeform.length} self-handled:${c.selfHandled.length} bodyless:${c.bodyless.length} ` +
    `uncovered:${c.uncovered.length}; excluded:[${c.excluded.join(", ")}]`
  );
}

function errorResponses(): Record<string, JsonSchema> {
  const body = {
    content: {
      "application/json": { schema: { $ref: "#/components/schemas/Error" } },
    },
  };

  return {
    BadRequest: { description: "Malformed or invalid request", ...body },
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
