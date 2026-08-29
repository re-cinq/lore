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
import { secondsEnvMs } from "./intervals.js";

const CLAIM_TIMEOUT_MS = 30_000;

export const CLAIM_BASE_INTERVAL_S_DEFAULT = 15;
export const CLAIM_MAX_IDLE_DELAY_MS = 60_000;

export function claimIntervalMs(env: NodeJS.ProcessEnv): number {
  return secondsEnvMs(
    env.LORE_CLUSTER_AGENT_CLAIM_INTERVAL_S,
    CLAIM_BASE_INTERVAL_S_DEFAULT,
  );
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
  /** The CR was already there — a requeued visit converging on the name its
   *  previous attempt used. Reported apart from a fresh launch because no new
   *  pod exists: the terminal event of the CR still standing dedupes against the
   *  one that attempt already produced, so this row would sit claimed behind a
   *  finished CR. */
  | { kind: "already-running"; stationRunId: string; crName: string }
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
  launch: (spec: LoreTaskSpec) => Promise<{ ref: string; launched?: boolean }>;
  fetchFn?: typeof fetch;
}

export interface ReleaseDeps {
  apiUrl: string;
  identity: () => ClusterAgentIdentity;
  /** The station-run ROW, which is what the queue requeues (the row-id-as-
   *  visit-order contract) — not the station_run_id. */
  nodeRowId: string;
  reason: string;
  fetchFn?: typeof fetch;
}

/**
 * Hand back a visit this cluster claimed and could not launch.
 *
 * The claim CASes the row to `claimed` before any pod exists, so a launch that
 * throws leaves a claimed row with nothing behind it. Left unsaid, that row
 * waits — centrally until the reaper notices the missing CR, on a satellite
 * (whose CRs the centre cannot see) for the whole node budget. One extra call
 * is the difference between a wasted claim and a wasted hour.
 *
 * Never throws: it runs inside the tick's failure path, where a second failure
 * must not become the loop's.
 */
export async function releaseClaim(deps: ReleaseDeps): Promise<void> {
  const fetchFn = deps.fetchFn ?? fetch;
  const { id, token } = deps.identity();

  try {
    const res = await fetchFn(
      `${deps.apiUrl}/api/cluster-agents/${id}/release`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          node_row_id: deps.nodeRowId,
          reason: deps.reason,
        }),
        signal: AbortSignal.timeout(CLAIM_TIMEOUT_MS),
      },
    );

    if (!res.ok) {
      console.warn(
        `[cluster-agent] releasing station run row ${deps.nodeRowId} refused (HTTP ${res.status}) — the reaper is what recovers it now`,
      );
    }
  } catch (err) {
    console.warn(
      `[cluster-agent] could not release station run row ${deps.nodeRowId}: ${errorMessage(err)}`,
    );
  }
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

  let claim: ClaimResponse;

  try {
    claim = (await res.json()) as ClaimResponse;
  } catch (err) {
    // A 200 carrying a proxy error page would otherwise reject out of the loop
    // and kill the poller for good — the one throw the outcome union missed.
    return {
      kind: "error",
      message: `claim response parse failed: ${errorMessage(err)}`,
    };
  }

  // The ROW's name wins. The watch's terminal report, the reconcile pass and the
  // fork replay all correlate by what the Floor recorded there; the spec carries
  // a second copy of the same fact, and a copy is exactly the thing that can go
  // stale — a re-dispatch converging on an existing row keeps the spec it was
  // armed with. Launching under the spec's spelling when the two differ produces
  // a CR no row names, whose terminal event matches nothing: the node waits out
  // its timeout and reads as a run nobody ever launched.
  const rowName = claim.agent_cr_name;
  const specName = claim.spec.name;

  if (rowName && specName && rowName !== specName) {
    return {
      kind: "error",
      message: `claim for station run ${claim.station_run_id} disagrees about its CR name: row says ${rowName}, spec says ${specName} — refusing a launch nothing could correlate`,
    };
  }
  const name = rowName ?? specName;

  if (!name) {
    return {
      kind: "error",
      message: `claim for station run ${claim.station_run_id} carries no CR name — refusing an unlabelled launch`,
    };
  }
  const spec: LoreTaskSpec = { ...claim.spec, name };

  try {
    const { ref, launched } = await deps.launch(spec);

    return {
      kind: launched === false ? "already-running" : "claimed",
      stationRunId: claim.station_run_id,
      crName: ref,
    };
  } catch (err) {
    await releaseClaim({
      apiUrl: deps.apiUrl,
      identity: deps.identity,
      nodeRowId: claim.node_row_id,
      reason: errorMessage(err),
      fetchFn: deps.fetchFn,
    });

    return {
      kind: "error",
      message: `launch failed for station run ${claim.station_run_id}, visit handed back: ${errorMessage(err)}`,
    };
  }
}

/**
 * The kill switch a shutdown throws.
 *
 * Without one the claim loop keeps ticking through the drain: a claim lands, the
 * API records the visit as claimed by this agent, and `process.exit` cuts the
 * launch — mint, Secret write, catalog clone, CR create — somewhere in the
 * middle. That is a claimed row with no CR (or a half-written per-task pair) on
 * every rollout, and the queue is busiest exactly when rollouts hurt.
 */
export function stopLatch(): { running: () => boolean; stop: () => void } {
  let alive = true;

  return {
    running: () => alive,
    stop: () => {
      alive = false;
    },
  };
}

export interface ClaimLoopDeps {
  claim: () => Promise<ClaimOutcome>;
  /** Re-registers with the persisted current_token after a 401/403. A null
   *  result (API down, identity lost) is fine — the next tick tries again. */
  reRegister: () => Promise<ClusterAgentIdentity | null>;
  sleep: (ms: number) => Promise<void>;
  baseDelayMs: number;
  maxIdleDelayMs?: number;
  /** Bounds the loop: a shutdown's latch, or a test's. */
  running?: () => boolean;
  log?: (message: string) => void;
  /** Runs after each outcome is logged — the shutdown latch's seam in tests. */
  onOutcome?: (outcome: ClaimOutcome) => void;
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

      if (outcome.kind === "already-running") {
        log(
          `[cluster-agent] station run ${outcome.stationRunId} claimed, but Agent CR ${outcome.crName} already exists — no new pod launched; the CR's terminal event or the reaper will settle the visit`,
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
      deps.onOutcome?.(outcome);
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
