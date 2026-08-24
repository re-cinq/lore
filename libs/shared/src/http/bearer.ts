/**
 * The service-to-service credential check.
 *
 * Shared by every Lore service that accepts a bearer token, so the comparison,
 * the status codes and the wording are decided once.
 *
 * The comparison is TIMING-SAFE. `===` on a secret leaks its length and its
 * matching prefix through response timing, and a bearer token is exactly the
 * kind of secret that gets probed. The HMAC path next door in the event-router
 * already used `timingSafeEqual`; this had not, which made two checks on the
 * same request inconsistent about the same threat.
 *
 * Kept a plain function rather than a hapi auth strategy: the event-router's
 * `/api/events` must choose between this and a signature check INSIDE the
 * handler, and a strategy would have to pick before the handler can look at the
 * headers.
 */

import { timingSafeEqual } from "node:crypto";
import { enforceTrue } from "../lib/enforce.js";
import { apiError } from "./api-error.js";

/** Constant-time string compare that does not leak length either. */
function secretEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);

  // `timingSafeEqual` throws on length mismatch, so the lengths are compared
  // first — that comparison is not itself constant-time, but the length of a
  // bearer token is not the secret; its bytes are.
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/**
 * Refuse the request unless it carries the expected bearer token.
 *
 * `service` names the deployment whose env var is missing, so a 503 says which
 * knob to turn rather than that "a token" is unset.
 */
export function enforceBearer(
  headers: Record<string, unknown>,
  token: string | undefined,
  service = "this service",
): void {
  const auth = headers["authorization"];

  enforceTrue(
    token,
    apiError(503),
    `token not configured — set LORE_INGEST_TOKEN on the ${service} deployment`,
  );
  enforceTrue(
    typeof auth === "string" && secretEquals(auth, `Bearer ${token}`),
    apiError(401),
    "missing or invalid bearer token — this endpoint requires Authorization: Bearer <LORE_INGEST_TOKEN>",
  );
}
