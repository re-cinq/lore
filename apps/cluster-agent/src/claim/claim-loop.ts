// Pull-based claim loop (FR3, specs/running-stations-in-any-k8s-cluster): polls claim, launches an Agent CR on a hit, backs off while idle, re-registers on 401/403.

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

/** The claim response body (200). `spec` is the complete dispatch spec the Floor's launch seam enqueued. */
export interface ClaimResponse {
  station_run_id: string;
  /** String-encoded bigint — a JS number would silently lose precision past 2^53. */
  node_row_id: string;
  assembly_run_id: string;
  node_id: string;
  iteration: number;
  /** Null for a row enqueued without a CR name armed yet — the spec's own name is the fallback then. */
  agent_cr_name: string | null;
  spec: LoreTaskSpec;
}

export type ClaimOutcome =
  | { kind: "claimed"; stationRunId: string; crName: string }
  /** The CR was already there — a requeued visit converging on a prior attempt's name; no new pod launched. */
  | { kind: "already-running"; stationRunId: string; crName: string }
  | { kind: "empty" }
  | { kind: "unauthorized" }
  | { kind: "error"; message: string };

// Idle back-off: only a 204 grows the delay (doubling to the cap); errors poll again at base. A claim never sleeps — the queue just proved it has work.
export function nextClaimDelay(
  baseMs: number,
  idleTicks: number,
  outcome: ClaimOutcome["kind"],
  maxIdleMs: number = CLAIM_MAX_IDLE_DELAY_MS,
): number {
  if (outcome === "claimed") {
    return 0;
  }

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
  /** The station-run ROW the queue requeues by (row-id-as-visit-order) — not the station_run_id. */
  nodeRowId: string;
  reason: string;
  fetchFn?: typeof fetch;
}

// Hand back a visit this cluster claimed and could not launch — left unsaid, it waits out the whole node budget on a satellite. Never throws (runs in the tick's failure path).
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

async function requestClaim(
  deps: ClaimTickDeps,
): Promise<Response | ClaimOutcome> {
  const fetchFn = deps.fetchFn ?? fetch;
  const { id, token } = deps.identity();

  try {
    return await fetchFn(`${deps.apiUrl}/api/cluster-agents/${id}/claim`, {
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
}

function isClaimOutcome(value: Response | ClaimOutcome): value is ClaimOutcome {
  return "kind" in value;
}

async function readClaimBody(
  res: Response,
): Promise<ClaimResponse | ClaimOutcome> {
  if (res.status === 204) {
    return { kind: "empty" };
  }

  if (res.status === 401 || res.status === 403) {
    return { kind: "unauthorized" };
  }

  if (!res.ok) {
    return { kind: "error", message: `claim refused (HTTP ${res.status})` };
  }

  try {
    return (await res.json()) as ClaimResponse;
  } catch (err) {
    // A 200 carrying a proxy error page would otherwise kill the poller for good — the one throw the outcome union missed.
    return {
      kind: "error",
      message: `claim response parse failed: ${errorMessage(err)}`,
    };
  }
}

function isClaimBody(
  value: ClaimResponse | ClaimOutcome,
): value is ClaimResponse {
  return !("kind" in value);
}

// The ROW's name wins — the watch, reconcile, and fork replay all correlate by it; launching under the spec's spelling instead orphans the CR from its row.
function resolveCrName(claim: ClaimResponse): string | ClaimOutcome {
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

  return name;
}

async function launchClaim(
  deps: ClaimTickDeps,
  claim: ClaimResponse,
  spec: LoreTaskSpec,
): Promise<ClaimOutcome> {
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

/** One poll: claim, and launch what was claimed. Never throws — every failure shape is an outcome. */
export async function claimOnce(deps: ClaimTickDeps): Promise<ClaimOutcome> {
  const res = await requestClaim(deps);

  if (isClaimOutcome(res)) {
    return res;
  }
  const body = await readClaimBody(res);

  if (!isClaimBody(body)) {
    return body;
  }
  const name = resolveCrName(body);

  if (typeof name !== "string") {
    return name;
  }
  const spec: LoreTaskSpec = { ...body.spec, name };

  return launchClaim(deps, body, spec);
}

// The kill switch a shutdown throws — without it a claim can land and `process.exit` cuts the launch mid-CR-create on every rollout.
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
  /** Re-registers with the persisted current_token after a 401/403; a null result is fine — the next tick tries again. */
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
