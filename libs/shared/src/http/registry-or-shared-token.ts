/**
 * The two-credential check a front door uses when BOTH the central cluster and
 * a registered satellite may call it (specs/running-stations-in-any-k8s-cluster).
 *
 * A satellite must never hold a bus-wide secret — that is the whole point of
 * FR5 — but it does hold a per-agent token, minted at registration and stored
 * only as a SHA-256 in `pipeline.cluster_agents.token_hash`. So a shared door
 * accepts either: the bus-wide token, or a bearer whose hash matches a
 * registry row. Rotating or deregistering the agent revokes its access in the
 * same place as its claiming credential.
 *
 * Layered deliberately ON TOP of `bearer.ts` rather than inside it: that
 * module owns the single-credential check and its wording, decided once; this
 * is a policy built from those pieces, and a door that wants only the shared
 * token should keep reaching for `enforceBearer` directly.
 *
 * The shared token is compared FIRST, without a lookup, so the central
 * cluster's own calls cost no SELECT; the registry is consulted only for a
 * bearer that is not it. Agent `status` (`active`/`offline`) is deliberately
 * not checked — a cluster that has gone quiet, or is mid-token-rotation, is
 * still the sender of whatever it is delivering, and refusing it would drop
 * data rather than protect anything. A miss falls through to `enforceBearer`,
 * so the refusal is byte-for-byte the one that door gave before it accepted
 * two credentials.
 */

import { enforceBearer, extractBearer, secretEquals } from "./bearer.js";
import { hashAgentToken } from "../project/cluster-agents/cluster-agent-token.js";
import type { ClusterAgentsRepository } from "../project/cluster-agents/cluster-agents-port.js";

export interface RegistryOrSharedTokenDeps {
  /** The bus-wide token; absent means it is unconfigured (500, not 401). */
  sharedToken?: string;
  /** The registry lookup; absent means per-agent tokens are not accepted. */
  findByTokenHash?: ClusterAgentsRepository["findByTokenHash"];
  /** The env var holding `sharedToken`, so an unconfigured-token refusal names
   *  the knob this door actually reads. Defaults to the ingest token. */
  sharedTokenEnvName?: string;
}

/**
 * Refuse the request unless it carries the shared token or a registered
 * per-agent token. Pure over its deps, so tests need no Postgres.
 *
 * `service` names the deployment in the refusal, exactly as `enforceBearer`
 * uses it — an unconfigured token should say which knob to turn.
 */
export async function enforceRegistryOrSharedToken(
  headers: Record<string, unknown>,
  deps: RegistryOrSharedTokenDeps,
  service: string,
): Promise<void> {
  const token = extractBearer(headers["authorization"]);

  if (
    token !== undefined &&
    deps.sharedToken !== undefined &&
    secretEquals(token, deps.sharedToken)
  ) {
    return;
  }

  if (
    token !== undefined &&
    deps.findByTokenHash &&
    (await deps.findByTokenHash(hashAgentToken(token)))
  ) {
    return;
  }

  enforceBearer(headers, deps.sharedToken, service, deps.sharedTokenEnvName);
}
