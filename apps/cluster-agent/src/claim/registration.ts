// Boot-time registration (FR1, specs/running-stations-in-any-k8s-cluster): presents the pre-shared token, receives the durable {id, token} identity; a known name re-registers only via its persisted current_token.

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

// The registration triple, or a refusal to boot — since dispatch flipped push→pull (FR3), an unregistered cluster-agent claims nothing and its queue goes silently quiet.
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
  /** Publishes the freshly-minted per-agent token as run pods' telemetry credential; optional so tests can skip it. */
  publishTelemetryCredential?: (
    identity: ClusterAgentIdentity,
  ) => Promise<void>;
}

/** One registration attempt: persists and returns the identity on 200, null on any failure. NEVER throws — `pollUntil` has no catch, so a throw here would end the boot registrant for good. */
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

/** One attempt, which may throw — `registerOnce` is the wrapper that promises it never does. Null means retry. */
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
  // Both first registration and every rotation land here, so the run pods' credential never outlives its token.
  await deps.publishTelemetryCredential?.(identity);

  return identity;
}

/** Retry registration on the 30s→5m schedule until it succeeds. Never throws or gives up — an unreachable API on boot must not crash the process. */
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
