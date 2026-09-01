/**
 * lore-api's one call into the cluster agent.
 *
 * What used to live here — rendering the UI-authored CRD pair and pushing it
 * at `CLUSTER_AGENT_URL` — is gone (specs/catalog-db-sync FR8.6): a save
 * writes its row and its catalog event, and every cluster's sync loop renders
 * and applies from the DB. That closed the door where an unvalidated,
 * credential-less render reached a cluster, and it removed the single-target
 * push that never reached a satellite at all.
 *
 * The operator restart below is unrelated and stays. lore-api holds no
 * Kubernetes client and needs no Kubernetes RBAC.
 */

import { ClusterAgentClient } from "@re-cinq/lore-shared";
import { internalToken } from "@re-cinq/lore-shared/http/internal-token.js";

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

/** Bounces the cluster-agent process itself — see restart.ts's route comment
 *  for why this can only ever reach the central cluster. */
export async function restartClusterAgent(): Promise<void> {
  const { baseUrl, token } = clusterAgentCredentials(process.env);

  await new ClusterAgentClient(baseUrl, token).call("POST", "/restart");
}
