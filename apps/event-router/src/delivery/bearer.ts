// The reporting/draining credential check.
//
// Shared by every route except the GitHub branch of `/api/events`, which
// authenticates by HMAC over its raw body instead and never presents a token.
//
// Not a hapi auth strategy: `/api/events` has to choose between this and the
// signature check INSIDE the handler, and a strategy would have to pick before
// the handler can look at the headers. One function both callers invoke keeps
// the two paths honest about being the same check.

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "./api-error.js";

export function enforceBearer(
  headers: Record<string, unknown>,
  token: string | undefined,
): void {
  const auth = headers["authorization"] as string | undefined;

  enforceTrue(
    token,
    apiError(503),
    "reporting token not configured — set LORE_INGEST_TOKEN on the event-router deployment",
  );
  enforceTrue(
    auth === `Bearer ${token}`,
    apiError(401),
    "missing or invalid bearer token — this endpoint requires Authorization: Bearer <LORE_INGEST_TOKEN>",
  );
}
