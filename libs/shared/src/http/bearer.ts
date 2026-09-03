/** Service-to-service credential check: timing-safe comparison shared by all Lore services accepting bearer tokens. */

import { timingSafeEqual } from "node:crypto";
import { enforceTrue } from "../lib/enforce.js";
import { apiError } from "./api-error.js";

/** Constant-time string compare. */
export function secretEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);

  // timingSafeEqual throws on length mismatch; token length is not secret, only bytes.
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/** Bearer credential from Authorization header or undefined; case-insensitive scheme, RFC 7235 §2.1. */
export function extractBearer(header: unknown): string | undefined {
  const raw = Array.isArray(header) ? header[0] : header;

  if (typeof raw !== "string") {
    return undefined;
  }

  const match = /^Bearer\s+(.+)$/i.exec(raw);

  return match ? match[1] : undefined;
}

/** Refuse request without bearer token; unconfigured is 500 not 503 (retries won't fix deploy). */
export function enforceBearer(
  headers: Record<string, unknown>,
  token: string | undefined,
  service = "this service",
  // Which env var holds this door's token; defaulted (most callers use LORE_INGEST_TOKEN except Floor telemetry sink).
  tokenEnvName = "LORE_INGEST_TOKEN",
): void {
  const auth = headers["authorization"];

  enforceTrue(
    token,
    apiError(500),
    `token not configured — set ${tokenEnvName} on the ${service} deployment`,
  );
  enforceTrue(
    typeof auth === "string" && secretEquals(auth, `Bearer ${token}`),
    apiError(401),
    `missing or invalid bearer token — this endpoint requires Authorization: Bearer <${tokenEnvName}>`,
  );
}
