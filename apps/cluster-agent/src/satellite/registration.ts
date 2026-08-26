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
 * network; the composition shell lives in start-satellite.ts.
 */

import { errorMessage } from "@re-cinq/lore-shared";
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

/** Null when any of the three required vars is unset — registration (and with
 *  it the claim loop) simply stays off; the inbound-push routes still work. */
export function registrationConfig(
  env: NodeJS.ProcessEnv,
): RegistrationConfig | null {
  const apiUrl = env.LORE_API_URL;
  const registrationToken = env.LORE_CLUSTER_AGENT_REGISTRATION_TOKEN;
  const name = env.LORE_CLUSTER_AGENT_NAME;

  if (!apiUrl || !registrationToken || !name) {
    return null;
  }

  return {
    apiUrl: apiUrl.replace(/\/+$/, ""),
    registrationToken,
    name,
    tags: parseTags(env.LORE_CLUSTER_AGENT_TAGS),
  };
}

/** The idle schedule between failed registration attempts: 30s doubling to 5m. */
export function nextRegistrationDelay(currentMs: number): number {
  return Math.min(currentMs * 2, REGISTRATION_MAX_DELAY_MS);
}

export interface RegisterDeps {
  config: RegistrationConfig;
  store: IdentityStore;
  fetchFn?: typeof fetch;
}

/** One registration attempt. Persists and returns the identity on 200; null on
 *  any failure — the caller owns the retry schedule, and the process must keep
 *  serving its inbound routes either way. */
export async function registerOnce(
  deps: RegisterDeps,
): Promise<ClusterAgentIdentity | null> {
  const { config, store } = deps;
  const fetchFn = deps.fetchFn ?? fetch;
  const current = await store.load();

  let res: Response;

  try {
    res = await fetchFn(`${config.apiUrl}/api/cluster-agents/register`, {
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
  } catch (err) {
    console.warn(
      `[cluster-agent] registration fetch failed for ${config.name} at ${config.apiUrl}: ${errorMessage(err)}`,
    );

    return null;
  }

  if (!res.ok) {
    console.warn(
      `[cluster-agent] registration of ${config.name} refused (HTTP ${res.status})` +
        (res.status === 409
          ? " — the name is registered to another identity and no current_token matched"
          : ""),
    );

    return null;
  }

  const body = (await res.json()) as { id: string; token: string };
  const identity = { id: body.id, token: body.token };

  await store.save(identity);

  return identity;
}

/** Retry registration on the 30s→5m schedule until it succeeds. Never throws,
 *  never gives up — an unreachable API on boot must not crash the process. */
export async function registerWithBackoff(
  deps: RegisterDeps & { sleep: (ms: number) => Promise<void> },
): Promise<ClusterAgentIdentity> {
  let delayMs = REGISTRATION_BASE_DELAY_MS;

  for (;;) {
    const identity = await registerOnce(deps);

    if (identity) {
      return identity;
    }
    await deps.sleep(delayMs);
    delayMs = nextRegistrationDelay(delayMs);
  }
}
