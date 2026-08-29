/**
 * Publishing the satellite's own credential to its run pods.
 *
 * Every seeded recipe's telemetry sink posts NDJSON to the Floor's
 * `/api/agent-events` with `headers_secret: agent-events-auth` — the
 * subsystem reads that key out of `agent-secrets` and sends its VALUE
 * verbatim as HTTP header lines, so it must be the whole
 * `Authorization: Bearer <token>` line, not a bare token.
 *
 * On the central cluster ESO fills that key with the bus-wide
 * `LORE_AGENT_INTERNAL_TOKEN`. A satellite has no such secret and must never
 * hold one (FR5 of specs/running-stations-in-any-k8s-cluster) — but since the
 * Floor's sink now also accepts any registered cluster-agent's per-agent
 * token, the satellite can publish ITS OWN. That is the whole feature: the
 * credential a satellite already legitimately holds becomes the one its pods
 * report telemetry with.
 *
 * Written after every successful registration, not just the first, because a
 * rotation mints a new token and the old value would authenticate nothing.
 * The write is a merge into a Secret the per-task GitHub provisioner also
 * writes to, which is why it goes through `SecretKeyWriter` (read-modify-
 * replace with conflict retry) rather than a whole-Secret replace.
 */

import { errorMessage } from "@re-cinq/lore-shared";
import type { SecretKeyWriter } from "../kernel/kube-token-provisioner.js";
import type { ClusterAgentIdentity } from "./identity-store.js";

/** The Secret the ai-agents subsystem mounts run-pod credentials from. */
const AGENT_SECRETS = process.env.LORE_AGENT_SECRETS_NAME ?? "agent-secrets";

/** The key the seeded recipes' `headers_secret` names. */
export const AGENT_EVENTS_AUTH_KEY = "agent-events-auth";

/**
 * Whether THIS cluster publishes the key, or leaves it to whoever already does.
 *
 * A cluster holding the bus-wide token is inside the platform, and there ESO
 * templates this key from `LORE_AGENT_INTERNAL_TOKEN` and rewrites it every
 * hour. Publishing there makes two writers of one key — the agent's value and
 * ESO's alternating, with pods created in between carrying whichever landed
 * last. A satellite holds no such token and no such writer, which is the whole
 * case this feature exists for.
 */
export function publishesAgentEventsAuth(env: NodeJS.ProcessEnv): boolean {
  return !env.LORE_INGEST_TOKEN;
}

/** The header LINE the subsystem sends verbatim — not a bare token. */
export function agentEventsAuthHeader(identity: ClusterAgentIdentity): string {
  return `Authorization: Bearer ${identity.token}`;
}

/**
 * Publish the per-agent token as the run pods' telemetry credential.
 *
 * Never throws: telemetry is not worth failing a registration over. A
 * satellite that cannot write this key still registers, claims and executes —
 * it just reports no live per-tool-call data, which is exactly where this
 * feature started.
 */
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
