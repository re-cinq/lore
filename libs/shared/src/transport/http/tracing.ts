/** One OTel span per request via onRequest → onPreResponse, covering every request including 401/404 ones; no-op until an OTel SDK is registered.  */

import Boom from "@hapi/boom";
import type { Request, Server } from "@hapi/hapi";
import { trace, SpanStatusCode, type Span } from "@opentelemetry/api";

declare module "@hapi/hapi" {
  interface RequestApplicationState {
    /** The request's OTel span, opened in onRequest and closed in onPreResponse. */
    span?: Span;
  }
}

/** What a service records for every request BESIDE the span — lore-api's http metrics; absent, the span is the only telemetry. */
export type RequestObserver = (
  method: string,
  path: string,
  statusCode: number,
  durationMs: number,
) => void;

export interface RequestTracing {
  /** Names the instrumentation scope the spans belong to, e.g. `lore.floor.http`. */
  tracerName: string;
  observe?: RequestObserver;
}

export function registerRequestTracing(
  server: Server,
  tracing: RequestTracing,
): void {
  openRequestSpan(server, tracing.tracerName);
  closeRequestSpan(server, tracing.observe);
}

/** Opens the span. Named `http.request` here and RENAMED to the matched route on the way out — the route is not known yet at onRequest, and a span named after the raw path would make one span per id. */
function openRequestSpan(server: Server, tracerName: string): void {
  const tracer = trace.getTracer(tracerName);

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

/** Closes the span. Runs on onPreResponse rather than the response event so it still fires for a request that never reached a handler — a 404 or an auth refusal is exactly the kind a dashboard needs to show. */
function closeRequestSpan(server: Server, observe?: RequestObserver): void {
  server.ext("onPreResponse", (request, h) => {
    const statusCode = statusOf(request);

    observe?.(
      request.method.toUpperCase(),
      request.path,
      statusCode,
      Date.now() - request.info.received,
    );

    const span = request.app.span;

    if (span) {
      finishSpan(span, request, statusCode);
    }

    return h.continue;
  });
}

function statusOf(request: Request): number {
  const res = request.response;

  return Boom.isBoom(res) ? res.output.statusCode : res.statusCode;
}

/** Runs only after hapi has matched, which is the earliest the route name and the Boom-or-response status are both known. */
function finishSpan(span: Span, request: Request, statusCode: number): void {
  const res = request.response;
  const route = request.route.path;

  span.updateName(`${request.method.toUpperCase()} ${route}`);
  span.setAttribute("http.route", route);
  span.setAttribute("http.status_code", statusCode);

  if (Boom.isBoom(res)) {
    span.recordException(res);
    span.setStatus({ code: SpanStatusCode.ERROR, message: res.message });
  }

  span.end();
}
