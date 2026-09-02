/**
 * Request tracing for the Floor HTTP server — the "middleware" that means no
 * handler hand-rolls its own span. One span per request via the
 * onRequest → onPreResponse lifecycle, so it covers *every* request, including
 * auth-rejected (401) and unmatched (404) ones. Records method/route/status and,
 * on a Boom error response, the exception. Handlers can annotate the span via
 * `request.app.span`. All calls are no-ops until an OTel SDK is registered
 * (otel-init).
 */

import Boom from "@hapi/boom";
import type { Server } from "@hapi/hapi";
import { trace, SpanStatusCode, type Span } from "@opentelemetry/api";

const tracer = trace.getTracer("lore.floor.http");

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
    const span = request.app.span;

    if (!span) {
      return h.continue;
    }

    const res = request.response;
    const route = request.route?.path ?? request.path;

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

    return h.continue;
  });
}
