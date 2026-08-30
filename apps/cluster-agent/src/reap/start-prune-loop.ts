/**
 * The prune loop's composition root: the live cluster adapter, the schedule,
 * and a latch the drain closes.
 *
 * Separate from `startClaimLoop` on purpose — this loop needs no registration
 * and no identity. It is cluster-local housekeeping, so coupling it to the
 * registrant would make a cluster that cannot register also stop tidying up,
 * which is exactly when its backlog grows fastest.
 */

import { stopLatch } from "../claim/claim-loop.js";
import { KubePruner } from "../kernel/kube-pruner.js";
import {
  pruneIntervalMs,
  pruneOnce,
  pruneTtlMs,
  runPruneLoop,
} from "./prune-loop.js";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface PruneLoopHandle {
  stop: () => void;
}

export function startPruneLoop(env: NodeJS.ProcessEnv): PruneLoopHandle {
  const latch = stopLatch();
  const cluster = new KubePruner();

  void runPruneLoop({
    prune: () => pruneOnce({ cluster, ttlMs: pruneTtlMs(env) }),
    sleep,
    intervalMs: pruneIntervalMs(env),
    running: latch.running,
  }).catch((err) => {
    // Unreachable by design (pruneOnce never throws), but a defect here must
    // surface as a log rather than an unhandled rejection killing a process
    // whose real job is claiming work.
    console.error("[cluster-agent] prune loop crashed:", err);
  });

  return { stop: latch.stop };
}
