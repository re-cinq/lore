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
import type { CrdPair } from "./agent-crd.js";

let catalog: HttpAgentCatalog | undefined;

function agentCatalog(): HttpAgentCatalog {
  return (catalog ??= new HttpAgentCatalog(
    new ClusterAgentClient(
      process.env.CLUSTER_AGENT_URL ?? "",
      process.env.LORE_INGEST_TOKEN,
    ),
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
