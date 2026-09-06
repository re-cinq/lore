/** Who may report an event (FR5): bus-wide LORE_INGEST_TOKEN or per-agent token registered in cluster_agents. */

import {
  enforceRegistryOrSharedToken,
  type RegistryOrSharedTokenDeps,
} from "@re-cinq/lore-shared/http/registry-or-shared-token.js";

export interface ReporterAuthDeps {
  /** The bus-wide token; absent means it is unconfigured (500, as today). */
  ingestToken?: string;
  /** The registry lookup; absent means per-agent tokens are not accepted. */
  findByTokenHash?: RegistryOrSharedTokenDeps["findByTokenHash"];
}

/** Refuse unless ingest token or registered per-agent token; pure, no Postgres needed. */
export function enforceReporterToken(
  headers: Record<string, unknown>,
  deps: ReporterAuthDeps,
): Promise<void> {
  return enforceRegistryOrSharedToken(
    headers,
    { sharedToken: deps.ingestToken, findByTokenHash: deps.findByTokenHash },
    "event-router",
  );
}
