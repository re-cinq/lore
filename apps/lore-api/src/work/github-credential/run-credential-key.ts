import { createHmac } from "node:crypto";

/** The key run credentials are signed with: an HMAC of the ingest token under a fixed label, so a run credential never exposes or reuses the ingest token itself and no new secret has to be provisioned. */
export function runCredentialKey(env: { LORE_INGEST_TOKEN?: string }): string {
  return createHmac("sha256", env.LORE_INGEST_TOKEN ?? "")
    .update("lore-run-credential-v1")
    .digest("hex");
}
