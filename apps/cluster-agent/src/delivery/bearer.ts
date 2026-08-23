// The reporting/draining credential check.
//
// Shared by every route except every route here — this service has one kind of caller.
//
// Kept as a plain function rather than a hapi strategy so every route states
// its own guard where a reader can see it.

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
