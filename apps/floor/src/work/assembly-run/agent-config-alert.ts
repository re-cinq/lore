// A misconfigured/unreachable skills_source takes down every Claude-agent node on the cluster at once, so this fires one operator alert from the terminal door (not the reaper, which only sees CR phase) — reads raw `output` not `errorText`, since claude crashes before printing the structured result line normalizeAgentStatus's lift needs.

import { classifyError } from "@re-cinq/lore-shared/error-classify.js";
import type { NotifyLevel } from "@re-cinq/lore-shared/project/notify/notify-port.js";
import { BillingAlertThrottle } from "./billing-alert.js";

/** The terminal status slice the alert reads. */
export interface AgentConfigAlertStatus {
  output?: string;
  failureReason?: string;
}

// Pure: the operator alert for a missing-settings CR failure, else null. Classifies over the raw output, not the Job-level `failureReason` (BackoffLimitExceeded), which would misclassify this as ordinary retryable infra flakiness.
export function agentConfigAlertMessage(
  repo: string,
  nodeType: string,
  status: AgentConfigAlertStatus,
): string | null {
  const text = status.output ?? "";
  const { category, hint } = classifyError(text);

  if (category !== "agent-settings-missing") {
    return null;
  }

  return (
    `Lore agent runs are failing: an AgentDefinition's skills registry is unreachable ` +
    `("Settings file not found: /agent/.claude/settings.json"). Every Claude-agent node ` +
    `the affected cluster claims stays blocked until skills_source is fixed. ` +
    `First seen on ${repo} (${nodeType} node). ${hint}`
  );
}

export interface AgentConfigAlertPorts {
  notify: (level: NotifyLevel, message: string) => Promise<unknown>;
  throttle: BillingAlertThrottle;
}

// Fire the throttled missing-settings alert if this terminal status matches; best-effort — a notify throw is logged, never propagated, so it can't fail the node-event handler or re-drive the event.
export async function maybeAlertAgentConfig(
  repo: string,
  nodeType: string,
  status: AgentConfigAlertStatus,
  ports: AgentConfigAlertPorts,
): Promise<boolean> {
  const message = agentConfigAlertMessage(repo, nodeType, status);

  if (!message || !ports.throttle.claim()) {
    return false;
  }

  try {
    await ports.notify("escalation", message);

    return true;
  } catch (err) {
    console.error(
      "[agent-config-alert] notify send failed:",
      (err as Error).message,
    );

    return false;
  }
}
