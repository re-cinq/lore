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
 * Scope: this guard exists for POST /api/events ONLY. The drain and delivery
 * surfaces keep the plain `enforceBearer`, because producing and draining are
 * different privileges even when one token happens to hold both.
 *
 * The ingest token is compared first, without a lookup, so the central
 * cluster's own reports cost no SELECT; a registry row is consulted only for a
 * bearer that is not the ingest token. Status (`active`/`offline`) is
 * deliberately not checked: an offline agent must still deliver a late
 * terminal report, and dedupe keys make duplicates safe. A miss falls through
 * to `enforceBearer`, so the refusal is byte-for-byte today's 401 (or 500 when
 * the ingest token is unconfigured).
 */

import {
  enforceBearer,
  extractBearer,
  secretEquals,
} from "@re-cinq/lore-shared/http/bearer.js";
import { hashAgentToken } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agent-token.js";
import type { ClusterAgentsRepository } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agents-port.js";

export interface ReporterAuthDeps {
  /** The bus-wide token; absent means it is unconfigured (500, as today). */
  ingestToken?: string;
  /** The registry lookup; absent means per-agent tokens are not accepted. */
  findByTokenHash?: ClusterAgentsRepository["findByTokenHash"];
}

/** Refuse the request unless it carries the ingest token or a registered
 *  per-agent token. Pure over its deps, so tests need no Postgres. */
export async function enforceReporterToken(
  headers: Record<string, unknown>,
  deps: ReporterAuthDeps,
): Promise<void> {
  const token = extractBearer(headers["authorization"]);

  if (token !== undefined && deps.ingestToken !== undefined) {
    if (secretEquals(token, deps.ingestToken)) {
      return;
    }
  }

  if (token !== undefined && deps.findByTokenHash) {
    if (await deps.findByTokenHash(hashAgentToken(token))) {
      return;
    }
  }

  enforceBearer(headers, deps.ingestToken, "event-router");
}
