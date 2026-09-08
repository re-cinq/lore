import "@re-cinq/lore-shared/http/hapi-params.js";
/** Lore-api HTTP server construction (hapi, ADR-033); shared by production and tests via buildServer. */

import type { Pool } from "pg";
import { routeList } from "../transport/route-list.js";
import Hapi from "@hapi/hapi";
import type { ServerRoute } from "@hapi/hapi";
import { registerRequestTracing } from "@re-cinq/lore-shared/http/tracing.js";
import { traceHttp } from "@re-cinq/lore-server-core/platform/otel.js";
import { registerRateLimit } from "../transport/http/rate-limit.js";
import { registerBearerScope } from "../transport/http/bearer-scope.js";
import { zodFailAction } from "../transport/http/zod-validate.js";
import {
  generateOpenApi,
  summarizeCoverage,
} from "../transport/openapi/build-document.js";

// 1 MB body cap applied to every native route via the server payload default.
const MAX_BODY_BYTES = 1_048_576;

function logOpenApiCoverage(routes: ServerRoute[]): void {
  const { coverage } = generateOpenApi(routes);

  console.log(summarizeCoverage(coverage));

  if (coverage.uncovered.length) {
    console.warn(
      `[openapi] WARNING uncovered write routes: ${coverage.uncovered.join(", ")}`,
    );
  }
}

// `traceHttp` is the metric half the span does not carry — lore-api recorded it per request before the tracing plugin was shared, and still does.
const TRACING = { tracerName: "lore.api.http", observe: traceHttp };

export function buildServer(getPool: () => Pool | null, port = 0): Hapi.Server {
  const server = Hapi.server({
    port,
    host: "0.0.0.0",
    routes: {
      // ADR-034: parse JSON regardless of Content-Type (preserve pre-hapi agnostic behavior).
      payload: { maxBytes: MAX_BODY_BYTES, override: "application/json" },
      // Zod schemas fail through zodFailAction, shaping every 400 as { error }.
      validate: { failAction: zodFailAction },
    },
  });

  registerRequestTracing(server, TRACING);
  registerRateLimit(server);
  registerBearerScope(server, getPool);

  const routes = routeList(getPool);

  server.route(routes);

  // Surface OpenAPI coverage at boot (FR7, drift-guard test enforces via CI).
  if (!process.env.VITEST) {
    logOpenApiCoverage(routes);
  }

  return server;
}
