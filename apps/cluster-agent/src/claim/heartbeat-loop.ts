import { errorMessage } from "@re-cinq/lore-shared";
import { runPollLoop } from "@re-cinq/lore-shared/lib/poll-loop.js";
import type { ClusterAgentIdentity } from "./identity-store.js";

/**
 * The liveness half of FR4 (specs/running-stations-in-any-k8s-cluster): a
 * 30-second POST bumping `last_seen_at`, so the reaper's offline sweep can
 * tell a dead cluster from a quiet one. A failed beat is logged and skipped —
 * the next one is 30 seconds away, and the 5-minute offline threshold absorbs
 * ten misses before anything is requeued.
 */

const DEFAULT_HEARTBEAT_S = 30;

export function heartbeatIntervalMs(env: NodeJS.ProcessEnv): number {
  const raw = Number(env.LORE_CLUSTER_AGENT_HEARTBEAT_S);

  return Number.isFinite(raw) && raw > 0
    ? raw * 1000
    : DEFAULT_HEARTBEAT_S * 1000;
}

export interface HeartbeatDeps {
  apiUrl: string;
  identity: () => ClusterAgentIdentity;
  fetchImpl?: typeof fetch;
  log?: (line: string) => void;
}

/** One beat. Returns "ok" | "unauthorized" | "error"; never throws. */
export async function heartbeatOnce(
  deps: HeartbeatDeps,
): Promise<"ok" | "unauthorized" | "error"> {
  const { id, token } = deps.identity();

  try {
    const res = await (deps.fetchImpl ?? fetch)(
      `${deps.apiUrl}/api/cluster-agents/${id}/heartbeat`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      },
    );

    if (res.status === 200) {
      return "ok";
    }

    if (res.status === 401 || res.status === 403) {
      return "unauthorized";
    }
    (deps.log ?? console.warn)(
      `[cluster-agent] heartbeat failed: HTTP ${res.status}`,
    );

    return "error";
  } catch (err) {
    (deps.log ?? console.warn)(
      `[cluster-agent] heartbeat failed: ${errorMessage(err)}`,
    );

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
