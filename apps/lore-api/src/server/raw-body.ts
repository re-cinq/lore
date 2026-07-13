import type { Request } from "@hapi/hapi";

/**
 * The unparsed request body as a string. The webhook ingress routes
 * (`/api/webhook/slack`, `/api/webhook/incident`) set `payload: { parse: false }`
 * so they can verify their own HMAC / handle URL-encoded bodies (ADR-034 FR7);
 * every JSON API route lets hapi parse the payload and reads `request.payload`.
 */
export function rawBody(request: Request): string {
  const payload = request.payload;

  if (Buffer.isBuffer(payload)) {
    return payload.toString("utf8");
  }

  if (typeof payload === "string") {
    return payload;
  }

  return "";
}
