import { errorMessage } from "@re-cinq/lore-shared";
import { runPollLoop } from "@re-cinq/lore-shared/lib/poll-loop.js";
import type { ClusterAgentIdentity } from "./identity-store.js";
import { secondsEnvMs } from "./intervals.js";

// Liveness half of FR4 (specs/running-stations-in-any-k8s-cluster): 30s POST bumping last_seen_at; the 5-minute offline threshold absorbs missed beats.

const DEFAULT_HEARTBEAT_S = 30;
const HEARTBEAT_TIMEOUT_MS = 30_000;

export function heartbeatIntervalMs(env: NodeJS.ProcessEnv): number {
  return secondsEnvMs(env.LORE_CLUSTER_AGENT_HEARTBEAT_S, DEFAULT_HEARTBEAT_S);
}

export interface HeartbeatDeps {
  apiUrl: string;
  identity: () => ClusterAgentIdentity;
  fetchImpl?: typeof fetch;
  log?: (line: string) => void;
}

function heartbeatLog(deps: HeartbeatDeps): (line: string) => void {
  return deps.log ?? console.warn;
}

async function postHeartbeat(
  deps: HeartbeatDeps,
  id: string,
  token: string,
): Promise<Response> {
  return (deps.fetchImpl ?? fetch)(
    `${deps.apiUrl}/api/cluster-agents/${id}/heartbeat`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(HEARTBEAT_TIMEOUT_MS),
    },
  );
}

/** One beat. Returns "ok" | "unauthorized" | "error"; never throws. */
export async function heartbeatOnce(
  deps: HeartbeatDeps,
): Promise<"ok" | "unauthorized" | "error"> {
  const { id, token } = deps.identity();
  const log = heartbeatLog(deps);

  try {
    const res = await postHeartbeat(deps, id, token);

    if (res.status === 200) {
      return "ok";
    }

    if (res.status === 401 || res.status === 403) {
      return "unauthorized";
    }
    log(`[cluster-agent] heartbeat failed: HTTP ${res.status}`);

    return "error";
  } catch (err) {
    log(`[cluster-agent] heartbeat failed: ${errorMessage(err)}`);

    return "error";
  }
}

export interface HeartbeatLoopDeps {
  beat: () => Promise<"ok" | "unauthorized" | "error">;
  /** Re-registration shared with the claim loop; null when it also failed. */
  reRegister: () => Promise<unknown>;
  sleep: (ms: number) => Promise<void>;
  intervalMs: number;
  running?: () => boolean;
}

/** Beat forever at the fixed interval; an unauthorized beat re-registers. */
export async function runHeartbeatLoop(deps: HeartbeatLoopDeps): Promise<void> {
  await runPollLoop<"ok" | "unauthorized" | "error">({
    tick: deps.beat,
    onOutcome: async (outcome) => {
      if (outcome === "unauthorized") {
        await deps.reRegister();
      }
    },
    delayFor: () => deps.intervalMs,
    sleep: deps.sleep,
    running: deps.running,
  });
}
