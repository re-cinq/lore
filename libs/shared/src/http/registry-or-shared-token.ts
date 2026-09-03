/** Two-credential check for central+satellite (specs/running-stations-in-any-k8s-cluster); shared token or registered per-agent token. */

import { enforceBearer, extractBearer, secretEquals } from "./bearer.js";
import { hashAgentToken } from "../project/cluster-agents/cluster-agent-token.js";
import type { ClusterAgentsRepository } from "../project/cluster-agents/cluster-agents-port.js";

export interface RegistryOrSharedTokenDeps {
  /** The bus-wide token; absent means it is unconfigured (500, not 401). */
  sharedToken?: string;
  /** The registry lookup; absent means per-agent tokens are not accepted. */
  findByTokenHash?: ClusterAgentsRepository["findByTokenHash"];
  /** Env var holding sharedToken; names the knob in unconfigured-token refusal (defaults to LORE_INGEST_TOKEN). */
  sharedTokenEnvName?: string;
}

/** Refuse request without shared or registered per-agent token; pure, test-friendly; service names deployment in refusal. */
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
