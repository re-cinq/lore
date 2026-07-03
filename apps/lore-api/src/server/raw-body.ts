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

/**
 * Parse the raw body as JSON with the legacy `readJsonBody` semantics: an empty
 * body is `{}`, a body over 1 MB throws `body too large`, and invalid JSON
 * throws. Routes that used `readJsonBody` (which caps at 1 MB and 400s on
 * failure) raise their `payload.maxBytes` above 1 MB and call this so the cap
 * surfaces as their own 400 rather than hapi's 413.
 */
export function parseJsonBodyCapped(request: Request): unknown {
  const raw = rawBody(request);
  if (Buffer.byteLength(raw, "utf8") > 1_048_576) throw new Error("body too large");
  return raw ? JSON.parse(raw) : {};
}
