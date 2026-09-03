/** The Floor-side binding for `kubernetes.pod_log.appended`. Thin on purpose: the decision (well-formed vs. dropped) lives in `pod-log-ingest.ts`, tested against the in-memory store; this only supplies the pool-backed one. */

import type { EventHandler } from "../../main-loop/types.js";
import { pipeline } from "../../kernel/queues.js";
import { ingestPodLogChunks } from "./pod-log-ingest.js";
import { pruneTelemetry } from "./log-retention.js";

export const podLogAppended: EventHandler = (params) =>
  ingestPodLogChunks(params, pipeline().podLogs);

/** `cron.telemetry_prune.tick` — the 14-day reap for both telemetry tables. */
export const telemetryPrune: EventHandler = async () => {
  const repos = pipeline();

  console.log(
    `[telemetry-prune] ${await pruneTelemetry({
      runEvents: repos.agentRunEvents,
      podLogs: repos.podLogs,
    })}`,
  );
};
