/**
 * Who may report an event (FR5 of specs/running-stations-in-any-k8s-cluster).
 *
 * The reporting front door accepts two credentials: the bus-wide
 * `LORE_INGEST_TOKEN` (full access, exactly as before), or a per-agent token
 * whose SHA-256 matches a `pipeline.cluster_agents.token_hash` row — so a
 * satellite reports outcomes without ever holding the bus-wide secret, and
 * rotating or deregistering the agent revokes its reporting credential in the
 * same place as its claiming one.
 *
 * The policy itself is shared (`enforceRegistryOrSharedToken`): the Floor's
 * `/api/agent-events` telemetry sink needs the identical two-credential rule,
 * and one door accepting a satellite while the other silently did not is the
 * kind of split that only shows up in production. This module stays as the
 * event-router's NAME for that rule, and as the place its scope is recorded.
 *
 * Scope: this guard exists for POST /api/events ONLY. The drain and delivery
 * surfaces keep the plain `enforceBearer`, because producing and draining are
 * different privileges even when one token happens to hold both.
 */

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

/** Refuse the request unless it carries the ingest token or a registered
 *  per-agent token. Pure over its deps, so tests need no Postgres. */
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
