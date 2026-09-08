/** OpenAPI 3.1 document generation (ADR-035): projects routeList to operations with request/response contracts. */

import type { ServerRoute } from "@hapi/hapi";
import { bucketFor } from "../http/rate-limit.js";
import {
  WILDCARD_METHODS,
  METHOD_NOT_ALLOWED_FALLBACKS,
} from "./domain-routes.js";
import {
  optionsOf,
  responsesFor,
  registerResponse,
  applyRequestBody,
  errorResponses,
  type JsonSchema,
  type Coverage,
} from "./operation-responses.js";
import { CATEGORY_ORDER, tagFor } from "./route-categories.js";

export type { Coverage } from "./operation-responses.js";
export { tagFor } from "./route-categories.js";

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

export interface GenerateOptions {
  version?: string;
  serverUrl?: string;
}

const API_TITLE = "Lore API";
const DEFAULT_VERSION = "0.1.0";
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH"]);

const isExcludedPath = (path: string): boolean =>
  path === "/healthz" || path.startsWith("/dist/");

const isPublic = (route: ServerRoute): boolean =>
  optionsOf(route).auth === false;

function scopeOf(route: ServerRoute): string | undefined {
  const plugins = optionsOf(route).plugins as
    Record<string, { scope?: string } | undefined> | undefined;

  return plugins?.["bearer-scope"]?.scope;
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

function operationId(method: string, normPath: string): string {
  const slug = normPath
    .replace(/^\/+/, "")
    .replace(/[/{}]/g, "_")
    .replace(/_+/g, "_")
    .replace(/_$/, "");

  return `${method.toLowerCase()}_${slug}`;
}

/** The accumulators one document build threads through every route. */
interface DocumentBuild {
  coverage: Coverage;
  schemas: Record<string, JsonSchema>;
  paths: Record<string, Record<string, Operation>>;
}

/** The fields an operation carries only sometimes. They are set rather than always-present-and-empty because the generated client reads the DOCUMENT: an empty `parameters` array and an absent one produce different types. */
function applyOptionalFields(op: Operation, route: ServerRoute): void {
  const { params, hasOptional } = pathParameters(route.path);
  const scope = scopeOf(route);

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
}

/** The always-present half of an operation; the sometimes-present fields are layered on by `applyOptionalFields`. */
function baseOperation(
  route: ServerRoute,
  method: string,
  normPath: string,
  success: ReturnType<typeof registerResponse>,
): Operation {
  const publicOp = isPublic(route);
  const hasBody = WRITE_METHODS.has(method);

  return {
    operationId: operationId(method, normPath),
    summary: `${method} ${normPath}`,
    tags: [tagFor(normPath)],
    security: publicOp ? [] : [{ bearerAuth: [] }],
    "x-rate-limit-bucket": bucketFor(route.path),
    responses: responsesFor(publicOp, hasBody, success),
  };
}

function buildOperation(
  route: ServerRoute,
  method: string,
  normPath: string,
  { coverage, schemas }: DocumentBuild,
): Operation {
  const key = `${method} ${route.path}`;
  const success = registerResponse(route, key, schemas, coverage);
  const op = baseOperation(route, method, normPath, success);

  applyOptionalFields(op, route);

  if (WRITE_METHODS.has(method)) {
    applyRequestBody(op, route, method, coverage);
  }

  return op;
}

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

/** Key-sorted copy, so a generated artifact records WHAT is served rather than the order the routes were registered in — regrouping the route list would otherwise rewrite 10k lines of JSON and drown the real diff. Plain code-unit comparison, NOT localeCompare: collation varies with the runtime's ICU data, so a laptop and CI could sort identically-named paths differently and each would read the other's output as drift. */
function byKey<T>(entries: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(entries).sort(([a], [b]) => Number(a > b) - Number(a < b)),
  );
}

function emptyCoverage(): Coverage {
  return {
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
}

/** The document's own preamble — what this contract is generated from, and what the two OpenAPI extensions mean. Kept beside the builder because it describes THIS generator's conventions, not the API's behaviour. */
const DOCUMENT_DESCRIPTION =
  "Generated from the lore-api hapi route zod schemas (ADR-035). This document " +
  "describes request contracts, success bodies and the uniform `{ error }` error " +
  "envelope. A route declares its body with `zodResponse`; where that body shares " +
  "fields with a table, the schema is derived from that table's model and column " +
  "map, so a renamed column cannot leave the contract behind. The two routes that " +
  "declare none are `/api/openapi.json` (this document) and `/api/docs` (HTML). " +
  "Per-route required scope is the `x-required-scope` extension (HTTP bearer has no " +
  "scope list); the rate-limit bucket is `x-rate-limit-bucket`.";

/** The reusable half of the document: the auth scheme, the response schemas registered while walking the routes, and the shared error envelopes. */
function documentComponents(
  schemas: Record<string, JsonSchema>,
): OpenApiDocument["components"] {
  return {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
    schemas: byKey(schemas),
    responses: errorResponses(),
  };
}

/** Everything about the API that is NOT derived from walking the routes: its title, its description, and where it is served. */
function openApiDocument(input: {
  opts: GenerateOptions;
  usedTags: Set<string>;
  paths: Record<string, Record<string, Operation>>;
  schemas: Record<string, JsonSchema>;
}): OpenApiDocument {
  const { opts, usedTags, paths, schemas } = input;

  return {
    openapi: "3.1.0",
    info: {
      title: API_TITLE,
      version: opts.version ?? DEFAULT_VERSION,
      description: DOCUMENT_DESCRIPTION,
    },
    // Defaults to `/` when LORE_API_URL is unset; OpenAPI requires non-empty servers list.
    servers: [{ url: opts.serverUrl ?? "/" }],
    // Only categories actually in use, in canonical sidebar order.
    tags: CATEGORY_ORDER.filter((c) => usedTags.has(c.name)),
    paths: byKey(paths),
    components: documentComponents(schemas),
  };
}

const ERROR_SCHEMA: JsonSchema = {
  type: "object",
  properties: { error: { type: "string" } },
  required: ["error"],
};

/** Walks every route into `build`, recording the ones deliberately left out of the contract. */
function collectPaths(routes: ServerRoute[], build: DocumentBuild): void {
  for (const route of routes) {
    if (isExcludedPath(route.path)) {
      build.coverage.excluded.push(route.path);
      continue;
    }

    addRouteOperations(route, normalizePath(route.path), build);
  }
}

export function generateOpenApi(
  routes: ServerRoute[],
  opts: GenerateOptions = {},
): { document: OpenApiDocument; coverage: Coverage } {
  const schemas: Record<string, JsonSchema> = { Error: ERROR_SCHEMA };
  const paths: Record<string, Record<string, Operation>> = {};
  const coverage = emptyCoverage();

  collectPaths(routes, { coverage, schemas, paths });

  const usedTags = new Set<string>(
    Object.values(paths).flatMap((pathItem) =>
      Object.values(pathItem).map((op) => op.tags[0]),
    ),
  );

  const document = openApiDocument({ opts, usedTags, paths, schemas });

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
