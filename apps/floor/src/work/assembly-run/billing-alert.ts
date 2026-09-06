// A billing-classed CR failure takes down every LLM node at once, so it deserves one operator Slack alert (not a PR comment per run); the node-event handler is the only layer that still sees the agent's terminal text.

import { classifyError } from "@re-cinq/lore-shared/error-classify.js";
import type { NotifyLevel } from "@re-cinq/lore-shared/project/notify/notify-port.js";

/** The terminal status slice the alert reads. */
export interface BillingAlertStatus {
  /** The agent's own last words, lifted from the raw stream by `normalizeAgentStatus`. */
  errorText?: string;
  failureReason?: string;
}

/** Pure: the operator alert for a billing-classed CR failure, else null. Reads `errorText` (never unwraps `output` itself, since `normalizeAgentStatus` is the ONE owner of that lift — a second unwrap is how the alert silently never fired, #1455) and classifies via the shared `classifyError`, not a local matcher. */
export function billingAlertMessage(
  repo: string,
  nodeType: string,
  status: BillingAlertStatus,
): string | null {
  const text = status.errorText ?? status.failureReason ?? "";
  const { category, hint } = classifyError(text);

  if (category !== "anthropic-credit") {
    return null;
  }

  return (
    `Lore agent runs are failing: the Anthropic account is out of credits ("${text}"). ` +
    `Every LLM node — review, refine, triage, implementation — stays blocked until the ` +
    `balance is topped up. First seen on ${repo} (${nodeType} node). ${hint}`
  );
}

/** Global time-window gate: billing is account-wide, so this sends at most one alert per window across all repos instead of one per failed run. Injectable clock for tests. */
export class BillingAlertThrottle {
  private lastSentMs = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly windowMs = 60 * 60 * 1000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** True (and records the send) when the window has elapsed since the last claim. */
  claim(): boolean {
    const t = this.now();

    if (t - this.lastSentMs < this.windowMs) {
      return false;
    }
    this.lastSentMs = t;

    return true;
  }
}

export interface BillingAlertPorts {
  notify: (level: NotifyLevel, message: string) => Promise<unknown>;
  throttle: BillingAlertThrottle;
}

/** Fire the throttled billing alert if this status is a billing failure; best-effort — a notify throw is logged, never propagated, so it cannot fail or re-drive the node-event handler. Returns whether an alert was actually sent. */
export async function maybeAlertBilling(
  repo: string,
  nodeType: string,
  status: BillingAlertStatus,
  ports: BillingAlertPorts,
): Promise<boolean> {
  const message = billingAlertMessage(repo, nodeType, status);

  if (!message || !ports.throttle.claim()) {
    return false;
  }

  try {
    await ports.notify("escalation", message);

    return true;
  } catch (err) {
    console.error(
      "[billing-alert] notify send failed:",
      (err as Error).message,
    );

    return false;
  }
}
