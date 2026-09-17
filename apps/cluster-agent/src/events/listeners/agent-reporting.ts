// What the watch DOES with a CR, separated from the connection that delivers it — testable against a plain object and a fake lister, unlike the reconnect loop and live Watch beside it.

import { errorMessage } from "@re-cinq/lore-shared";
import type { Agent as AgentCr } from "@re-cinq/agent-contracts";
import { mapAgentToEvent } from "@re-cinq/lore-shared/project/events/k8s-map.js";
import type { Emit } from "@re-cinq/lore-shared/project/events/event-input-port.js";
import { GROUP, VERSION, AGENT_PLURAL as PLURAL } from "../../domain/crd.js";

// Re-exported so k8s-watch.ts reads the CRD identity through this module rather than a second import.
export { GROUP, VERSION, PLURAL };

export interface WatchDeps {
  /** Hand the event to the proxy — resolves once QUEUED, blocking while full (the only backpressure the watch has). */
  emit: Emit;
  /** Why a failed Agent's Job died, in the pod's own words; absent in tests that only watch phases. */
  failureCause?: (jobName: string) => Promise<string | undefined>;
}

/** The slice of CustomObjectsApi the paginated list needs; tests fake this. */

/** Map one observed CR and hand it to the proxy if terminal. A failed emit is logged and swallowed HERE — the caller is a watch callback with nobody to return a status to. */
export async function reportForAgent(
  agent: AgentCr,
  deps: WatchDeps,
): Promise<void> {
  const ev = mapAgentToEvent((await withFailureCause(agent, deps)) as never);

  if (!ev) {
    return;
  }

  try {
    await deps.emit({ kind: "event", event: ev });
  } catch (err) {
    console.error(
      `[cluster-agent] could not queue the report for ${agent.metadata?.name}:`,
      errorMessage(err),
    );
  }
}

/** A failed CR carries only the Job's `BackoffLimitExceeded`, which reads as "the pod died" whatever killed it; the pod still holds the real cause, and only this process can read pods. Best-effort: a pod already gone or unreadable leaves the Job reason to speak alone. */
async function withFailureCause(
  agent: AgentCr,
  deps: WatchDeps,
): Promise<AgentCr> {
  const jobName = agent.status?.jobName;

  if (agent.status?.phase !== "Failed" || !jobName || !deps.failureCause) {
    return agent;
  }
  const errorText = await deps.failureCause(jobName).catch((err: unknown) => {
    console.warn(
      `[cluster-agent] could not read why ${jobName} failed:`,
      errorMessage(err),
    );

    return undefined;
  });

  return errorText
    ? ({ ...agent, status: { ...agent.status, errorText } } as AgentCr)
    : agent;
}
