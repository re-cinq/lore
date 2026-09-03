/** OpenAPI 3.1 document generation (ADR-035): projects routeList to operations with request/response contracts. */

import type { ServerRoute, RouteOptions } from "@hapi/hapi";
import type { ZodType } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { getZodSchema } from "../server/plugins/zod-validate.js";
import {
  getResponseMeta,
  type OpenApiResponseMeta,
} from "../server/plugins/zod-response.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { bucketFor } from "../server/plugins/rate-limit.js";
import {
  WILDCARD_METHODS,
  METHOD_NOT_ALLOWED_FALLBACKS,
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

/** Report wildcard routes that declare neither real methods nor a wildcard in WILDCARD_METHODS. */
export function undeclaredWildcards(routes: ServerRoute[]): string[] {
  const isWildcard = (route: ServerRoute) =>
    (Array.isArray(route.method) ? route.method : [route.method]).includes("*");

  return routes
    .filter((route) => route.path.startsWith("/api/") && isWildcard(route))
    .map((route) => normalizePath(route.path))
    .filter(
      (path) =>
        !(path in WILDCARD_METHODS) &&
        !METHOD_NOT_ALLOWED_FALLBACKS.includes(path),
    );
}

/** `{owner}` / `{name?}` / `{artifact*}` → OpenAPI `{owner}`; strip optional/wildcard markers. */
export function normalizePath(hapiPath: string): string {
  return hapiPath.replace(/\{(\w+)[?*]\}/g, "{$1}");
}

/** Sidebar categories in display order; drift guard asserts every operation lands in real category. */
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
  {
    name: "Cluster Agents",
    description: "Execution-cluster registry and pull-based dispatch.",
  },
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
  {
    name: "Analytics",
    description: "Usage, org-wide pipeline analytics, and agent statistics.",
  },
  { name: "Tokens", description: "Scoped API token management." },
  {
    name: "Cluster Agents",
    description:
      "Execution-cluster registry and pull-based station-run dispatch (specs/running-stations-in-any-k8s-cluster).",
  },
  { name: "Meta", description: "The OpenAPI document and its reference UI." },
];

const UNCATEGORIZED = "Other";

/** Path→category rules, first match wins; ordered specific → general. */
const TAG_RULES: Array<[RegExp, string]> = [
  [/^\/api\/(openapi\.json|docs)$/, "Meta"],
  [/^\/api\/(context|graph|chunks|chunk-types)\b/, "Context"],
  [
    /^\/api\/(memory|memories|memory-search|memory-audit|episode|episodes|pools|graph-browse|session-summary)\b/,
    "Memory",
  ],
  [
    /^\/api\/(task|tasks|task-logs|task-stats|repo-tasks|agent-activity|audit-log|job-run-logs|spec-tasks|task-groups|assembly-lines|assembly-runs)\b/,
    "Tasks",
  ],
  [
    /^\/api\/(usage|analytics|analytics-overview|spend|agent-stats|memory-audit|events|job-runs)\b/,
    "Analytics",
  ],
  // Platform health (model access status) tagged analytics: same audience, same question.
  [/^\/api\/platform\//, "Analytics"],
  [/\/features\b/, "Features"],
  [/\/agent-definitions\b/, "Agents"],
  [/^\/api\/cluster-agents\b/, "Cluster Agents"],
  [/\/settings\/dark-factory\b/, "Dark Factory"],
  [/\/(trace|impact)\b/, "Traceability"],
  [/\/ingest/, "Ingestion"],
  [/^\/api\/embed$/, "Ingestion"],
  [/\/events\/\{id\}\/payload$/, "Ingestion"],
  [/\/webhook/, "Webhooks"],
  [/^\/api\/tokens\b/, "Tokens"],
  [/^\/api\/cluster-agents\b/, "Cluster Agents"],
  [/^\/api\/(repos|repo-status|pr-status|onboard|settings)\b/, "Repositories"],
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
  success?: { meta: OpenApiResponseMeta; ref: JsonSchema },
): Record<string, JsonSchema> {
  // Declared contract replaces generic 200 (not joins); two status types = union-to-unknown.
  const responses: Record<string, JsonSchema> = success
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
  const declared = new Set<number>(success?.meta.errors ?? []);

  if (hasBody || declared.has(400)) {
    responses["400"] = { $ref: "#/components/responses/BadRequest" };
  }

  // Auth:false routes that hand-authenticate (pre-shared token) declare 401 explicitly.
  if (declared.has(401)) {
    responses["401"] = { $ref: "#/components/responses/Unauthorized" };
  }

  if (declared.has(404)) {
    responses["404"] = { $ref: "#/components/responses/NotFound" };
  }

  if (declared.has(409)) {
    responses["409"] = { $ref: "#/components/responses/Conflict" };
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

/** Register response as named component; duplicate with different shape is hard error. */
function registerResponse(
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

/** The accumulators one document build threads through every route. */
interface DocumentBuild {
  coverage: Coverage;
  schemas: Record<string, JsonSchema>;
  paths: Record<string, Record<string, Operation>>;
}

function buildOperation(
  route: ServerRoute,
  method: string,
  normPath: string,
  { coverage, schemas }: DocumentBuild,
): Operation {
  const { params, hasOptional } = pathParameters(route.path);
  const publicOp = isPublic(route);
  const scope = scopeOf(route);
  const hasBody = WRITE_METHODS.has(method);
  const success = registerResponse(
    route,
    `${method} ${route.path}`,
    schemas,
    coverage,
  );
  const op: Operation = {
    operationId: operationId(method, normPath),
    summary: `${method} ${normPath}`,
    tags: [tagFor(normPath)],
    security: publicOp ? [] : [{ bearerAuth: [] }],
    "x-rate-limit-bucket": bucketFor(route.path),
    responses: responsesFor(publicOp, hasBody, success),
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
    applyRequestBody(op, route, method, coverage);
  }

  return op;
}

/** Self-handled body: handler verifies it, not JSON parsing; publish declared shape or note. */
function applySelfHandledBody(op: Operation, route: ServerRoute): void {
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
function applyRequestBody(
  op: Operation,
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

/** Generate the OpenAPI document plus the per-route coverage classification. */
/** Builds one Operation per method of the route into `paths`. */
function addRouteOperations(
  route: ServerRoute,
  normPath: string,
  build: DocumentBuild,
): void {
  for (const method of methodsOf(route)) {
    const operation = buildOperation(route, method, normPath, build);

    (build.paths[normPath] ??= {})[method.toLowerCase()] = operation;
  }
}

export function generateOpenApi(
  routes: ServerRoute[],
  opts: GenerateOptions = {},
): { document: OpenApiDocument; coverage: Coverage } {
  const schemas: Record<string, JsonSchema> = {
    Error: {
      type: "object",
      properties: { error: { type: "string" } },
      required: ["error"],
    },
  };
  const paths: Record<string, Record<string, Operation>> = {};
  const coverage: Coverage = {
    covered: [],
    lifted: [],
    freeform: [],
    selfHandled: [],
    bodyless: [],
    uncovered: [],
    excluded: [],
    responses: [],
    responsesMissing: [],
  };

  for (const route of routes) {
    if (isExcludedPath(route.path)) {
      coverage.excluded.push(route.path);
      continue;
    }
    const normPath = normalizePath(route.path);

    addRouteOperations(route, normPath, { coverage, schemas, paths });
  }

  const usedTags = new Set<string>(
    Object.values(paths).flatMap((pathItem) =>
      Object.values(pathItem).map((op) => op.tags[0]),
    ),
  );

  const document: OpenApiDocument = {
    openapi: "3.1.0",
    info: {
      title: API_TITLE,
      version: opts.version ?? DEFAULT_VERSION,
      description:
        "Generated from the lore-api hapi route zod schemas (ADR-035). This document " +
        "describes request contracts, success bodies and the uniform `{ error }` error " +
        "envelope. A route declares its body with `zodResponse`; where that body shares " +
        "fields with a table, the schema is derived from that table's model and column " +
        "map, so a renamed column cannot leave the contract behind. The two routes that " +
        "declare none are `/api/openapi.json` (this document) and `/api/docs` (HTML). " +
        "Per-route required scope is the `x-required-scope` extension (HTTP bearer has no " +
        "scope list); the rate-limit bucket is `x-rate-limit-bucket`.",
    },
    // Defaults to `/` when LORE_API_URL is unset; OpenAPI requires non-empty servers list.
    servers: [{ url: opts.serverUrl ?? "/" }],
    // Only categories actually in use, in canonical sidebar order.
    tags: CATEGORY_ORDER.filter((c) => usedTags.has(c.name)),
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
      schemas,
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
