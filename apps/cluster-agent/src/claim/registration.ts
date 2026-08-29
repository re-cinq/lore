/**
 * Boot-time registration with the Lore API (FR1 of
 * specs/running-stations-in-any-k8s-cluster): the cluster-agent presents the
 * pre-shared registration token, declares its name + capability tags, and
 * receives the durable `{id, token}` identity every later claim/heartbeat call
 * authenticates with.
 *
 * A known name re-registers only by presenting its persisted per-agent token
 * (`current_token`) — the registration token alone must never take over a live
 * cluster's identity — so the identity store is loaded before every attempt.
 *
 * All IO is injected (fetch, store, sleep) so the decisions test without a
 * network; the composition shell lives in start-claim-loop.ts.
 */

import { errorMessage } from "@re-cinq/lore-shared";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { pollUntil } from "@re-cinq/lore-shared/lib/poll-loop.js";
import type { ClusterAgentIdentity, IdentityStore } from "./identity-store.js";

const REGISTER_TIMEOUT_MS = 15_000;

export const REGISTRATION_BASE_DELAY_MS = 30_000;
export const REGISTRATION_MAX_DELAY_MS = 300_000;

export interface RegistrationConfig {
  apiUrl: string;
  registrationToken: string;
  name: string;
  tags: string[];
}

export function parseTags(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

/**
 * The registration triple, or a refusal to boot.
 *
 * There is no unregistered mode any more. Since dispatch flipped from push to
 * pull (FR3) a cluster-agent that does not register claims nothing, and a
 * cluster whose queued runs nobody claims does not fail — it goes quiet until
 * every run dies at the queue-wait bound. A crash naming the missing variable
 * is the only honest answer, and it is the one Kubernetes surfaces.
 *
 * Every missing name at once: an operator who learns one name per restart
 * restarts three times to read a list this function already holds.
 */
export function registrationConfig(env: NodeJS.ProcessEnv): RegistrationConfig {
  const apiUrl = env.LORE_API_URL;
  const registrationToken = env.LORE_CLUSTER_AGENT_REGISTRATION_TOKEN;
  const name = env.LORE_CLUSTER_AGENT_NAME;
  const missing = [
    apiUrl ? "" : "LORE_API_URL",
    registrationToken ? "" : "LORE_CLUSTER_AGENT_REGISTRATION_TOKEN",
    name ? "" : "LORE_CLUSTER_AGENT_NAME",
  ].filter((variable) => variable !== "");

  enforceTrue(
    apiUrl && registrationToken && name,
    Error,
    `cluster-agent cannot start: ${missing.join(", ")} unset. Every cluster-agent registers and claims its work; there is no mode that runs without these.`,
  );

  return {
    apiUrl: apiUrl.replace(/\/+$/, ""),
    registrationToken,
    name,
    tags: parseTags(env.LORE_CLUSTER_AGENT_TAGS),
  };
}

export interface RegisterDeps {
  config: RegistrationConfig;
  store: IdentityStore;
  fetchFn?: typeof fetch;
  /** Publishes the freshly-minted per-agent token as the run pods' telemetry
   *  credential. Optional: a composition without it (tests, a satellite whose
   *  pods have no sink configured) simply registers as before. */
  publishTelemetryCredential?: (
    identity: ClusterAgentIdentity,
  ) => Promise<void>;
}

/** One registration attempt. Persists and returns the identity on 200; null on
 *  any failure — the caller owns the retry schedule, and the process must keep
 *  serving its inbound routes either way.
 *
 *  NEVER throws. Every caller relies on it: `pollUntil` has no catch, so a throw
 *  here ends the boot registrant and leaves a Ready pod that claims nothing;
 *  through `reRegister` the same throw ends the claim loop, the heartbeat loop
 *  or the proxy's drain. A 200 carrying an ingress error page, a body missing
 *  its fields, and an identity Secret the Role cannot read or write are all
 *  refusals to retry, not reasons to stop. */
export async function registerOnce(
  deps: RegisterDeps,
): Promise<ClusterAgentIdentity | null> {
  try {
    return await attemptRegistration(deps);
  } catch (err) {
    console.warn(
      `[cluster-agent] registration of ${deps.config.name} failed: ${errorMessage(err)}`,
    );

    return null;
  }
}

/** One attempt, which may throw: `registerOnce` is the wrapper that promises it
 *  never does. Returns null for a refusal the caller should simply retry. */
async function attemptRegistration(
  deps: RegisterDeps,
): Promise<ClusterAgentIdentity | null> {
  const { config, store } = deps;
  const fetchFn = deps.fetchFn ?? fetch;
  const current = await store.load();
  const res = await fetchFn(`${config.apiUrl}/api/cluster-agents/register`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.registrationToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name: config.name,
      tags: config.tags,
      cluster_info: null,
      ...(current ? { current_token: current.token } : {}),
    }),
    signal: AbortSignal.timeout(REGISTER_TIMEOUT_MS),
  });

  if (!res.ok) {
    console.warn(
      `[cluster-agent] registration of ${config.name} refused (HTTP ${res.status})` +
        (res.status === 409
          ? " — the name is registered to another identity and no current_token matched"
          : ""),
    );

    return null;
  }

  const body = (await res.json()) as Partial<ClusterAgentIdentity>;

  enforceTrue(
    typeof body.id === "string" && typeof body.token === "string",
    Error,
    "registration answered 200 without an {id, token} body",
  );
  const identity = { id: body.id, token: body.token };

  await store.save(identity);
  // Both first registration and every rotation land here, so the run pods'
  // copy of the credential never outlives the token it carries.
  await deps.publishTelemetryCredential?.(identity);

  return identity;
}

/** Retry registration on the 30s→5m schedule until it succeeds. Never throws,
 *  never gives up — an unreachable API on boot must not crash the process. */
export async function registerWithBackoff(
  deps: RegisterDeps & { sleep: (ms: number) => Promise<void> },
): Promise<ClusterAgentIdentity> {
  return pollUntil<ClusterAgentIdentity>({
    tick: () => registerOnce(deps),
    baseDelayMs: REGISTRATION_BASE_DELAY_MS,
    maxDelayMs: REGISTRATION_MAX_DELAY_MS,
    sleep: deps.sleep,
  });
}
