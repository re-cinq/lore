/**
 * Landing the UI-authored catalog in the cluster.
 *
 * A shim over the cluster agent (ADR-024): lore-api renders the CRD pair from
 * the DB row, and the agent performs the create → 409 → replace that lands it.
 * The whole read-modify-write stays on the agent's side, so the live object's
 * unrendered fields — `output.watch`, helm's labels — cannot be amputated by a
 * merge split across the network. That amputation cost five days of
 * planning-result delivery in August 2026.
 *
 * lore-api holds no Kubernetes client and needs no Kubernetes RBAC.
 */

import { ClusterAgentClient, HttpAgentCatalog } from "@re-cinq/lore-shared";
import { internalToken } from "@re-cinq/lore-shared/http/internal-token.js";
import type { CrdPair } from "./agent-crd.js";

/**
 * Where the cluster agent is and what to present to it.
 *
 * The SERVICE-TO-SERVICE token, not the org-wide ingest one: the cluster-agent
 * chart mounts `lore-agent-internal-token` on the guard these calls hit, while
 * lore-api's own `LORE_INGEST_TOKEN` is a different secret with a different
 * value. Sending it 401'd every catalog apply — a recipe saved in the UI wrote
 * its DB row and then never reached the cluster, so the next dispatch ran the
 * previous recipe. The Floor's client had this right; this one did not, which is
 * why the choice is now a named function with a test rather than an env read.
 */
export function clusterAgentCredentials(env: NodeJS.ProcessEnv): {
  baseUrl: string;
  token: string | undefined;
} {
  return {
    baseUrl: env.CLUSTER_AGENT_URL ?? "",
    token: internalToken(env),
  };
}

let catalog: HttpAgentCatalog | undefined;

function agentCatalog(): HttpAgentCatalog {
  if (catalog) {
    return catalog;
  }
  const { baseUrl, token } = clusterAgentCredentials(process.env);

  return (catalog = new HttpAgentCatalog(
    new ClusterAgentClient(baseUrl, token),
  ));
}

export async function applyAgentCrds(pair: CrdPair): Promise<void> {
  await agentCatalog().applyPair({
    agentDefinition: pair.agentDefinition,
    station: pair.station,
  });
}

export async function deleteAgentCrds(name: string): Promise<void> {
  await agentCatalog().deletePair(name);
}

/** Bounces the cluster-agent process itself — see restart.ts's route comment
 *  for why this can only ever reach the central cluster. */
export async function restartClusterAgent(): Promise<void> {
  const { baseUrl, token } = clusterAgentCredentials(process.env);

  await new ClusterAgentClient(baseUrl, token).call("POST", "/restart");
}
