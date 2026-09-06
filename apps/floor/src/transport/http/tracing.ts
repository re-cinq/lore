/** Request tracing for the Floor HTTP server: one span per request via onRequest → onPreResponse, covering every request including 401/404 ones; no-op until an OTel SDK is registered (otel-init). */

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

    return h.continue;
  });
}
