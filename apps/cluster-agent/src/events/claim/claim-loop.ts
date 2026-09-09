// Pull-based claim loop (FR3, specs/running-stations-in-any-k8s-cluster): polls claim, launches an Agent CR on a hit, backs off while idle, re-registers on 401/403.

import { errorMessage, type LoreTaskSpec } from "@re-cinq/lore-shared";
import {
  backoffDelay,
  runPollLoop,
} from "@re-cinq/lore-shared/lib/poll-loop.js";
import type { ClaimResponse } from "@re-cinq/lore-shared/project/cluster-agents/claim-response.js";
import type { ClusterAgentIdentity } from "../../domain/identity.js";
import { secondsEnvMs } from "../../lib/intervals.js";

const CLAIM_TIMEOUT_MS = 30_000;

export const CLAIM_BASE_INTERVAL_S_DEFAULT = 15;
export const CLAIM_MAX_IDLE_DELAY_MS = 60_000;

export function claimIntervalMs(env: NodeJS.ProcessEnv): number {
  return secondsEnvMs(
    env.LORE_CLUSTER_AGENT_CLAIM_INTERVAL_S,
    CLAIM_BASE_INTERVAL_S_DEFAULT,
  );
}

export type { ClaimResponse };

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
        ...releaseRequest(token, deps),
        signal: AbortSignal.timeout(CLAIM_TIMEOUT_MS),
      },
    );

    if (!res.ok) {
      warnReleaseRefused(deps.nodeRowId, `HTTP ${res.status}`);
    }
  } catch (err) {
    warnReleaseRefused(deps.nodeRowId, errorMessage(err));
  }
}

// The release, as the API expects it: which row to hand back, and why it could not be launched. The reason is stored, so a run released for a missing image reads differently from one released for a crash.
function releaseRequest(token: string, deps: ReleaseDeps): RequestInit {
  return {
    method: "POST",
    headers: bearerJson(token),
    body: JSON.stringify({
      node_row_id: deps.nodeRowId,
      reason: deps.reason,
    }),
  };
}

// A release that did not land. Warned rather than thrown: the visit stays claimed, and the reaper is what recovers it now — the tick that called this is already in its failure path.
function warnReleaseRefused(nodeRowId: string, reason: string): void {
  console.warn(
    `[cluster-agent] could not release station run row ${nodeRowId} (${reason}) — the reaper is what recovers it now`,
  );
}

// This cluster's registered token, on a JSON request.
function bearerJson(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
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
  const refusal = claimRefusal(res);

  if (refusal) {
    return refusal;
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

// Why this claim yielded no work, if it did not. The three are distinct on purpose: 204 is a quiet queue, 401/403 means this cluster's registration is no longer accepted and the loop must stop rather than hammer, and any other failure is transient.
function claimRefusal(res: Response): ClaimOutcome | null {
  if (res.status === 204) {
    return { kind: "empty" };
  }

  if (res.status === 401 || res.status === 403) {
    return { kind: "unauthorized" };
  }

  if (!res.ok) {
    return { kind: "error", message: `claim refused (HTTP ${res.status})` };
  }

  return null;
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
    return handBack(deps, claim, errorMessage(err));
  }
}

// A claim this cluster took and could not launch. Handed back before reporting, because a visit left claimed waits out the whole node budget on a satellite the Floor cannot see into.
async function handBack(
  deps: ClaimTickDeps,
  claim: ClaimResponse,
  message: string,
): Promise<ClaimOutcome> {
  await releaseClaim({
    apiUrl: deps.apiUrl,
    identity: deps.identity,
    nodeRowId: claim.node_row_id,
    reason: message,
    fetchFn: deps.fetchFn,
  });

  return {
    kind: "error",
    message: `launch failed for station run ${claim.station_run_id}, visit handed back: ${message}`,
  };
}

// The kill switch a shutdown throws — without it a claim can land and `process.exit` cuts the launch mid-CR-create on every rollout.
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
    onOutcome: (outcome) => reportOutcome(outcome, log, deps),
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

/** What each claim outcome means, and the one that needs action: an unauthorized claim means the per-agent token was rotated elsewhere, so this agent re-registers rather than looping on a credential it no longer holds. `already-running` is deliberately not an error — the CR exists, and its terminal event or the reaper settles the visit. */
async function reportOutcome(
  outcome: ClaimOutcome,
  log: (message: string) => void,
  deps: ClaimLoopDeps,
): Promise<void> {
  const line = outcomeLine(outcome);

  if (line) {
    log(line);
  }

  if (outcome.kind === "unauthorized") {
    log(
      "[cluster-agent] claim unauthorized — per-agent token rotated elsewhere; re-registering",
    );
    await deps.reRegister();
  }
  deps.onOutcome?.(outcome);
}

// What this outcome says in the log, or nothing when it is the unauthorized case the caller acts on. `already-running` reads as an explanation rather than a failure: the CR exists, and its terminal event or the reaper settles the visit.
function outcomeLine(outcome: ClaimOutcome): string | null {
  if (outcome.kind === "claimed") {
    return `[cluster-agent] claimed station run ${outcome.stationRunId} → Agent CR ${outcome.crName}`;
  }

  if (outcome.kind === "already-running") {
    return `[cluster-agent] station run ${outcome.stationRunId} claimed, but Agent CR ${outcome.crName} already exists — no new pod launched; the CR's terminal event or the reaper will settle the visit`;
  }

  return outcome.kind === "error" ? `[cluster-agent] ${outcome.message}` : null;
}
