// Cluster-agent calls and restart logic. DB sync renders CRDs per cluster (specs/catalog-db-sync FR8.6).

import { ClusterAgentClient } from "@re-cinq/lore-shared";
import { internalToken } from "@re-cinq/lore-shared/http/internal-token.js";

// Service-to-service token (not org-wide ingest); cluster-agent mounts lore-agent-internal-token.
export function clusterAgentCredentials(env: NodeJS.ProcessEnv): {
  baseUrl: string;
  token: string | undefined;
} {
  return {
    baseUrl: env.CLUSTER_AGENT_URL ?? "",
    token: internalToken(env),
  };
}

// Restart cluster-agent; can only reach central cluster (see restart.ts).
export async function restartClusterAgent(): Promise<void> {
  const { baseUrl, token } = clusterAgentCredentials(process.env);

  await new ClusterAgentClient(baseUrl, token).call("POST", "/restart");
}
