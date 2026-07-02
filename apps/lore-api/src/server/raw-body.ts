import type { Request } from "@hapi/hapi";

/**
 * The unparsed request body as a string. Native write routes set
 * `payload: { parse: false }` (so hapi delivers `request.payload` as a Buffer)
 * and JSON.parse it themselves inside a try — matching the legacy handlers'
 * `readBody` + `JSON.parse`, which 500 on invalid JSON regardless of the
 * request's Content-Type (hapi's own parser would 400 instead).
 */
export function rawBody(request: Request): string {
  const payload = request.payload;
  if (Buffer.isBuffer(payload)) return payload.toString("utf8");
  if (typeof payload === "string") return payload;
  return "";
}
