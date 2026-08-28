// A misconfigured or unreachable skills_source takes down every Claude-agent
// node on the affected cluster at once — deserves one operator-facing alert,
// same reasoning as the billing alert next door. This is the terminal door,
// not the reaper: the reaper only sees the CR's phase, never the agent's own
// crash text.
//
// Reads raw `output`, not `errorText`: claude crashes before it ever prints a
// terminal result line for this failure, so `normalizeAgentStatus`'s lift
// (which only recognizes a structured `is_error` result line) finds nothing —
// the message lives in a bare stderr line the agent's own supervisor forwards.

import { classifyError } from "@re-cinq/lore-shared/error-classify.js";
import type { NotifyLevel } from "@re-cinq/lore-shared/project/notify/notify-port.js";
import { BillingAlertThrottle } from "./billing-alert.js";

/** The terminal status slice the alert reads. */
export interface AgentConfigAlertStatus {
  output?: string;
  failureReason?: string;
}

/**
 * Pure: the operator alert for a missing-settings CR failure, else null.
 *
 * Classification comes from the shared `classifyError`, over the raw output —
 * not the Job-level `failureReason` (`BackoffLimitExceeded`), which says
 * nothing about why and would otherwise misclassify this as ordinary infra
 * flakiness worth retrying, when every attempt fails identically until
 * skills_source is fixed.
 */
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

/**
 * Fire the throttled missing-settings alert if this terminal status matches.
 * Best-effort by contract — a notify throw is logged, never propagated, so it
 * cannot fail the node-event handler or re-drive the event. Returns whether an
 * alert was actually sent.
 */
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
