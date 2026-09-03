// The prune loop's composition root — separate from `startClaimLoop` on purpose, since coupling housekeeping to the registrant would stop tidying exactly when a cluster cannot register and its backlog grows fastest.

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
    // Unreachable by design (pruneOnce never throws), but a defect here must surface as a log, not an unhandled rejection.
    console.error("[cluster-agent] prune loop crashed:", err);
  });

  return { stop: latch.stop };
}
