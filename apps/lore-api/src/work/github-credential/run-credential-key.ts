import { createHmac } from "node:crypto";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";

/** The key run credentials are signed with: an HMAC of the ingest token under a fixed label, so a run credential never exposes or reuses the ingest token itself and no new secret has to be provisioned. */
export function runCredentialKey(env: { LORE_INGEST_TOKEN?: string }): string {
  const ingestToken = env.LORE_INGEST_TOKEN;

  enforceTrue(
    ingestToken,
    Error,
    "LORE_INGEST_TOKEN is not set — lore-api cannot sign run credentials without it",
  );

  return createHmac("sha256", ingestToken)
    .update("lore-run-credential-v1")
    .digest("hex");
}
