/** Request tracing for the Floor HTTP server: one span per request via onRequest → onPreResponse, covering every request including 401/404 ones; no-op until an OTel SDK is registered (otel-init). */

import Boom from "@hapi/boom";
import type { Request, Server } from "@hapi/hapi";
import { trace, SpanStatusCode, type Span } from "@opentelemetry/api";

const tracer = trace.getTracer("lore.floor.http");

declare module "@hapi/hapi" {
  interface RequestApplicationState {
    /** The request's OTel span, opened in onRequest and closed in onPreResponse. */
    span?: Span;
  }
}

/** Opens the span. Named `http.request` here and RENAMED to the matched route on the way out — the route is not known yet at onRequest, and a span named after the raw path would make one span per id. */
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

/** Renames the span after the matched route and records the outcome. A Boom response is the error case: its status lives on `output`, and the span is marked ERROR so a 4xx/5xx is visible without reading attributes. */
function endSpanForResponse(span: Span, request: Request): void {
  const res = request.response;
  const route = request.route.path;

  span.updateName(`${request.method.toUpperCase()} ${route}`);
  span.setAttribute("http.route", route);

  span.setAttribute(
    "http.status_code",
    Boom.isBoom(res) ? res.output.statusCode : res.statusCode,
  );

  if (Boom.isBoom(res)) {
    span.recordException(res);
    span.setStatus({ code: SpanStatusCode.ERROR, message: res.message });
  }

  span.end();
}

/** Closes the span, recording the status and any Boom error. Runs on onPreResponse rather than the response event so it still fires for a request that never reached a handler. */
function closeRequestSpan(server: Server): void {
  server.ext("onPreResponse", (request, h) => {
    const span = request.app.span;

    if (span) {
      endSpanForResponse(span, request);
    }

    return h.continue;
  });
}

export function registerRequestTracing(server: Server): void {
  openRequestSpan(server);
  closeRequestSpan(server);
}
