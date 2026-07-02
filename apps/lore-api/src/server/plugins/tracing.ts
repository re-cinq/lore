/**
 * Per-request telemetry for the lore-api HTTP server — the "middleware" that
 * means no handler hand-rolls its own span or metric. One span per request via
 * the onRequest → onPreResponse lifecycle (covers *every* request, including
 * auth-rejected 401/403 and unmatched 404 ones), plus the `traceHttp` metrics
 * (request counter + latency histogram) the old `node:http` server recorded for
 * every request — so migrating off the bridge keeps the existing HTTP dashboards
 * intact and adds distributed-trace spans on top. All calls are no-ops until an
 * OTel SDK is registered (otel-init), which index.ts does before boot.
 */

import Boom from "@hapi/boom";
import type { Server } from "@hapi/hapi";
import { trace, SpanStatusCode, type Span } from "@opentelemetry/api";
import { traceHttp } from "@re-cinq/lore-server-core/platform/otel.js";

const tracer = trace.getTracer("lore.api.http");

declare module "@hapi/hapi" {
  interface RequestApplicationState {
    /** The request's OTel span, opened in onRequest and closed in onPreResponse. */
    span?: Span;
  }
}

export function registerRequestTracing(server: Server): void {
  server.ext("onRequest", (request, h) => {
    request.app.span = tracer.startSpan("http.request", {
      attributes: {
        "http.method": request.method.toUpperCase(),
        "http.target": request.path,
      },
    });
    return h.continue;
  });

  server.ext("onPreResponse", (request, h) => {
    const res = request.response;
    const statusCode = Boom.isBoom(res) ? res.output.statusCode : res.statusCode;
    // The request/latency metrics the old server recorded via traceHttp, for
    // every request. `request.info.received` is the epoch-ms request start.
    traceHttp(request.method.toUpperCase(), request.path, statusCode, Date.now() - request.info.received);

    const span = request.app.span;
    if (!span) return h.continue;
    const route = request.route?.path ?? request.path;
    span.updateName(`${request.method.toUpperCase()} ${route}`);
    span.setAttribute("http.route", route);
    span.setAttribute("http.status_code", statusCode);
    if (Boom.isBoom(res)) {
      span.recordException(res);
      span.setStatus({ code: SpanStatusCode.ERROR, message: res.message });
    }
    span.end();
    return h.continue;
  });
}
