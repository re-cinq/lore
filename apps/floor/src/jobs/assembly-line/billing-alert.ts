// A billing-classed CR failure (the Anthropic account out of credits) takes
// down EVERY LLM node at once — review, refine, triage, implementation — so it
// deserves one operator-facing Slack alert, not a PR comment per drowned run.
// The node-event handler is the only layer that still sees the agent's terminal
// text (finishLine downstream carries only a routing reason), so the detection
// lives here.

import {
  isBillingError,
  terminalErrorText,
} from "@re-cinq/lore-assembly-lines";
import type { NotifyLevel } from "@re-cinq/lore-shared/project/notify/notify-port.js";

/** The terminal status slice the alert reads. */
export interface BillingAlertStatus {
  output?: string;
  failureReason?: string;
}

/**
 * Pure: the operator alert for a billing-classed CR failure, else null. The
 * billing text rides the agent's terminal result line (`Credit balance is too
 * low`); the CR's own `failureReason` is only the Job-level `BackoffLimitExceeded`,
 * so read the result line first and fall back to the reason.
 */
export function billingAlertMessage(
  repo: string,
  nodeType: string,
  status: BillingAlertStatus,
): string | null {
  const text = terminalErrorText(status.output) ?? status.failureReason ?? null;

  if (!isBillingError(text)) {
    return null;
  }

  return (
    `Lore agent runs are failing: the Anthropic account is out of credits ("${text}"). ` +
    `Every LLM node — review, refine, triage, implementation — stays blocked until the ` +
    `balance is topped up. First seen on ${repo} (${nodeType} node).`
  );
}

/**
 * Global time-window gate. Billing is account-wide, so a single outage would
 * otherwise fire an alert for every failed run in the batch; this sends at most
 * one per window across all repos. Injectable clock for tests.
 */
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

/**
 * Fire the throttled billing alert if this terminal status is a billing failure.
 * Best-effort by contract — a notify throw is logged, never propagated, so it
 * cannot fail the node-event handler or re-drive the event. Returns whether an
 * alert was actually sent.
 */
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
