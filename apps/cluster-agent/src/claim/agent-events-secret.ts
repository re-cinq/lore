// Publishes the satellite's own per-agent token as run pods' telemetry credential — a satellite has no bus-wide LORE_AGENT_INTERNAL_TOKEN (FR5, specs/running-stations-in-any-k8s-cluster), so it uses its own; rewritten on every registration since rotation mints a new token.

import { errorMessage } from "@re-cinq/lore-shared";
import type { SecretKeyWriter } from "../kernel/kube-token-provisioner.js";
import type { ClusterAgentIdentity } from "./identity-store.js";

/** The Secret the ai-agents subsystem mounts run-pod credentials from. */
const AGENT_SECRETS = process.env.LORE_AGENT_SECRETS_NAME ?? "agent-secrets";

/** The key the seeded recipes' `headers_secret` names. */
export const AGENT_EVENTS_AUTH_KEY = "agent-events-auth";

// Whether THIS cluster publishes the key: skip on a platform cluster where ESO already templates it from LORE_AGENT_INTERNAL_TOKEN — two writers of one key would flap.
export function publishesAgentEventsAuth(env: NodeJS.ProcessEnv): boolean {
  return !env.LORE_INGEST_TOKEN;
}

/** The header LINE the subsystem sends verbatim — not a bare token. */
export function agentEventsAuthHeader(identity: ClusterAgentIdentity): string {
  return `Authorization: Bearer ${identity.token}`;
}

// Publish the per-agent token as run pods' telemetry credential. Never throws — telemetry is not worth failing registration over.
export async function writeAgentEventsAuth(
  writer: SecretKeyWriter,
  identity: ClusterAgentIdentity,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (!publishesAgentEventsAuth(env)) {
    return;
  }

  try {
    await writer.setKey(
      AGENT_SECRETS,
      AGENT_EVENTS_AUTH_KEY,
      agentEventsAuthHeader(identity),
    );
  } catch (err) {
    console.warn(
      `[cluster-agent] could not publish ${AGENT_EVENTS_AUTH_KEY} to ${AGENT_SECRETS} — run telemetry will be dropped: ${errorMessage(err)}`,
    );
  }
}
