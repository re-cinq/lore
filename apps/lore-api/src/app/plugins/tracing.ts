/** Per-request telemetry for lore-api HTTP server via OTel spans and metrics. */

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

/** Opens the span. Named `http.request` here and RENAMED to the matched route on the way out — the route is not known until hapi has matched it, and a span named after the raw path would make one span per id. */
function openRequestSpan(server: Server): void {
  server.ext("onRequest", (request, h) => {
    request.app.span = tracer.startSpan("http.request", {
      attributes: {
        "http.method": request.method.toUpperCase(),
        "http.target": request.path,
      },
    });

    return h.continue;
  });
}

/** Closes the span and records the request metrics. Runs on `onPreResponse` rather than the response event so it still fires for a request that never reached a handler — a 404 or an auth refusal is exactly the kind a dashboard needs to show. */
function closeRequestSpan(server: Server): void {
  server.ext("onPreResponse", (request, h) => {
    const res = request.response;
    const statusCode = Boom.isBoom(res)
      ? res.output.statusCode
      : res.statusCode;

    // Metrics the old server recorded for every request via traceHttp.
    traceHttp(
      request.method.toUpperCase(),
      request.path,
      statusCode,
      Date.now() - request.info.received,
    );

    const span = request.app.span;

    if (!span) {
      return h.continue;
    }
    const route = request.route.path;

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

export function registerRequestTracing(server: Server): void {
  openRequestSpan(server);
  closeRequestSpan(server);
}
