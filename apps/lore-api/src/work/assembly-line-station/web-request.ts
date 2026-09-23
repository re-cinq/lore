// The upgrade request as the WHATWG Request Hocuspocus reads (headers, URL parameters); the same ten lines planning-sync's own mount uses.

import type { IncomingMessage } from "node:http";

export function webRequest(request: IncomingMessage): Request {
  return new Request(urlOf(request), { headers: headersOf(request) });
}

export function urlOf(request: IncomingMessage): URL {
  return new URL(
    request.url ?? "/",
    `http://${request.headers.host ?? "host"}`,
  );
}

function headersOf(request: IncomingMessage): Headers {
  const headers = new Headers();

  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === "string") {
      headers.set(name, value);
    }
  }

  return headers;
}
