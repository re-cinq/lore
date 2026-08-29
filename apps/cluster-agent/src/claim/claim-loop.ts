/**
 * The pull-based claim loop (FR3 of specs/running-stations-in-any-k8s-cluster):
 * poll `POST /api/cluster-agents/{id}/claim`, and on a hit launch the returned
 * spec as an Agent CR in THIS cluster. Pull, not push, because a minikube or a
 * customer cluster is unreachable for inbound calls — the GitLab Runner model.
 *
 * An idle agent backs off (doubling to a 60s ceiling, resetting on the first
 * hit) so a fleet of quiet satellites costs the API a bounded trickle. A 401/403
 * means the token was rotated elsewhere; the loop re-registers under its
 * persisted identity and keeps going. A launch failure is logged and the loop
 * continues — the reaper's queue-wait and timeout bounds own recovery.
 *
 * Every side effect is injected (fetch, launch, sleep, re-register) so each
 * tick and the schedule test without a cluster or a network.
 */

import { errorMessage, type LoreTaskSpec } from "@re-cinq/lore-shared";
import {
  backoffDelay,
  runPollLoop,
} from "@re-cinq/lore-shared/lib/poll-loop.js";
import type { ClusterAgentIdentity } from "./identity-store.js";

const CLAIM_TIMEOUT_MS = 30_000;

export const CLAIM_BASE_INTERVAL_S_DEFAULT = 15;
export const CLAIM_MAX_IDLE_DELAY_MS = 60_000;

export function claimIntervalMs(env: NodeJS.ProcessEnv): number {
  const seconds = Number(env.LORE_CLUSTER_AGENT_CLAIM_INTERVAL_S);

  if (!Number.isFinite(seconds) || seconds <= 0) {
    return CLAIM_BASE_INTERVAL_S_DEFAULT * 1000;
  }

  return seconds * 1000;
}

/** The claim response body (200). `spec` is the complete dispatch spec the
 *  Floor's launch seam enqueued; nothing here needs a synced catalog. */
export interface ClaimResponse {
  station_run_id: string;
  /** String-encoded bigint (the agent_run_events discipline) — a JS number
   *  would silently lose precision past 2^53. */
  node_row_id: string;
  assembly_run_id: string;
  node_id: string;
  iteration: number;
  /** Null for a row enqueued without a CR name armed yet — the spec's own
   *  name is the fallback identity then. */
  agent_cr_name: string | null;
  spec: LoreTaskSpec;
}

export type ClaimOutcome =
  | { kind: "claimed"; stationRunId: string; crName: string }
  | { kind: "empty" }
  | { kind: "unauthorized" }
  | { kind: "error"; message: string };

/** The idle back-off schedule: only a 204 grows the delay — the FIRST idle
 *  tick keeps the base interval, consecutive ones double it to the cap. A
 *  successful claim resets it, and errors keep polling at the base — they are
 *  not idleness. `idleTicks` counts the consecutive empties BEFORE this one. */
export function nextClaimDelay(
  baseMs: number,
  idleTicks: number,
  outcome: ClaimOutcome["kind"],
  maxIdleMs: number = CLAIM_MAX_IDLE_DELAY_MS,
): number {
  if (outcome !== "empty") {
    return baseMs;
  }

  return backoffDelay(baseMs, idleTicks, maxIdleMs);
}

export interface ClaimTickDeps {
  apiUrl: string;
  identity: () => ClusterAgentIdentity;
  launch: (spec: LoreTaskSpec) => Promise<{ ref: string }>;
  fetchFn?: typeof fetch;
}

/** One poll: claim, and launch what was claimed. Never throws — every failure
 *  shape is an outcome the loop can act on. */
export async function claimOnce(deps: ClaimTickDeps): Promise<ClaimOutcome> {
  const fetchFn = deps.fetchFn ?? fetch;
  const { id, token } = deps.identity();

  let res: Response;

  try {
    res = await fetchFn(`${deps.apiUrl}/api/cluster-agents/${id}/claim`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(CLAIM_TIMEOUT_MS),
    });
  } catch (err) {
    return {
      kind: "error",
      message: `claim fetch failed: ${errorMessage(err)}`,
    };
  }

  if (res.status === 204) {
    return { kind: "empty" };
  }

  if (res.status === 401 || res.status === 403) {
    return { kind: "unauthorized" };
  }

  if (!res.ok) {
    return { kind: "error", message: `claim refused (HTTP ${res.status})` };
  }

  const claim = (await res.json()) as ClaimResponse;
  // The CR name must be the one the Floor recorded on the station_run row —
  // the watch's terminal report and the fork replay both correlate by it.
  const specName = claim.spec.name ?? claim.agent_cr_name;

  if (!specName) {
    return {
      kind: "error",
      message: `claim for station run ${claim.station_run_id} carries no CR name — refusing an unlabelled launch`,
    };
  }
  const spec: LoreTaskSpec = { ...claim.spec, name: specName };

  try {
    const { ref } = await deps.launch(spec);

    return { kind: "claimed", stationRunId: claim.station_run_id, crName: ref };
  } catch (err) {
    return {
      kind: "error",
      message: `launch failed for station run ${claim.station_run_id}: ${errorMessage(err)}`,
    };
  }
}

export interface ClaimLoopDeps {
  claim: () => Promise<ClaimOutcome>;
  /** Re-registers with the persisted current_token after a 401/403. A null
   *  result (API down, identity lost) is fine — the next tick tries again. */
  reRegister: () => Promise<ClusterAgentIdentity | null>;
  sleep: (ms: number) => Promise<void>;
  baseDelayMs: number;
  maxIdleDelayMs?: number;
  /** Tests bound the loop; production runs forever. */
  running?: () => boolean;
  log?: (message: string) => void;
}

export async function runClaimLoop(deps: ClaimLoopDeps): Promise<void> {
  const log = deps.log ?? ((message: string): void => console.log(message));

  await runPollLoop<ClaimOutcome>({
    tick: deps.claim,
    onOutcome: async (outcome) => {
      if (outcome.kind === "claimed") {
        log(
          `[cluster-agent] claimed station run ${outcome.stationRunId} → Agent CR ${outcome.crName}`,
        );
      }

      if (outcome.kind === "error") {
        log(`[cluster-agent] ${outcome.message}`);
      }

      if (outcome.kind === "unauthorized") {
        log(
          "[cluster-agent] claim unauthorized — per-agent token rotated elsewhere; re-registering",
        );
        await deps.reRegister();
      }
    },
    isIdle: (outcome) => outcome.kind === "empty",
    delayFor: (outcome, idleTicks) =>
      nextClaimDelay(
        deps.baseDelayMs,
        idleTicks,
        outcome.kind,
        deps.maxIdleDelayMs,
      ),
    sleep: deps.sleep,
    running: deps.running,
  });
}
