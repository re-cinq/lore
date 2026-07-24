// The station contract's outcome parsing (ADR-031 D4/D9): map a terminal Agent
// CR status to the node outcome the transition replay routes on. Precedence on
// Succeeded: the contract's LORE_NODE_RESULT line → the agent review
// REVIEW_RESULT line → success. A CR phase of Failed (crash, non-zero exit, Job
// deadline) is an infrastructure failure, distinct from a station reporting
// outcome "failed" as its normal result. Consumed by the Floor's node-event
// handler + reaper and (parseNodeResult) by the lore-station pod itself.

import type { AssemblyLineNode } from "./loader.js";
import type { NodeResult, StageOutcome } from "./node-types.js";

/** The slice of an Agent's status the outcome mapping reacts to. */
export interface AgentNodeStatus {
  phase?: string;
  output?: string;
  failureReason?: string;
}

const OUTCOMES = new Set<StageOutcome>([
  "success",
  "changes_requested",
  "failed",
]);

/** Review nodes ask the agent to print exactly one REVIEW_RESULT line. */
export function parseReviewVerdict(
  output?: string,
): "success" | "changes_requested" | null {
  if (!output) {
    return null;
  }

  if (/REVIEW_RESULT:\s*CHANGES_REQUESTED/i.test(output)) {
    return "changes_requested";
  }

  if (/REVIEW_RESULT:\s*APPROVED/i.test(output)) {
    return "success";
  }

  return null;
}

/**
 * The station contract's terminal line: `LORE_NODE_RESULT: {"outcome": ...,
 * "extras": {...}}`. Null on absence or any malformation — callers fall back to
 * the older signals rather than failing the node over a formatting slip.
 */
export function parseNodeResult(output?: string): NodeResult | null {
  const match = output?.match(/LORE_NODE_RESULT:\s*(\{.*\})/);

  if (!match) {
    return null;
  }
  let payload: unknown;

  try {
    payload = JSON.parse(match[1]);
  } catch {
    return null;
  }
  const { outcome, extras } = payload as {
    outcome?: string;
    extras?: Record<string, unknown>;
  };

  if (!OUTCOMES.has(outcome as StageOutcome)) {
    return null;
  }
  const stringExtras: Record<string, string> = {};

  for (const [key, value] of Object.entries(extras ?? {})) {
    if (typeof value === "string") {
      stringExtras[key] = value;
    }
  }

  return { outcome: outcome as StageOutcome, extras: stringExtras };
}

/**
 * A CR failure whose text is the Anthropic account running dry (`Credit balance
 * is too low`, `insufficient credits`) — an operator-actionable, not
 * code-actionable, failure: it takes down EVERY LLM node (review/refine/triage/
 * implementation) at once until the account is topped up, so the Floor routes it
 * to a dedicated throttled Slack alert instead of one PR comment per drowned run.
 */
export function isBillingError(text: string | null | undefined): boolean {
  if (!text) {
    return false;
  }
  const lower = text.toLowerCase();

  return (
    (lower.includes("credit") && lower.includes("balance")) ||
    lower.includes("credit balance too low") ||
    lower.includes("insufficient credit")
  );
}

const failureKind = (node: AssemblyLineNode): string =>
  node.type === "agent" ? "agent" : "station";

/** Map a terminal Agent status to the node outcome (see precedence above).
 *  The set of outcomes this can return per node type is mirrored by
 *  PRODUCIBLE_OUTCOMES in loader.ts (the load-time edge-coverage check) — keep
 *  the two in sync when adding an outcome. */
export function stationNodeOutcome(
  node: AssemblyLineNode,
  status: AgentNodeStatus,
): NodeResult {
  if (status.phase === "Failed") {
    return {
      outcome: "failed",
      extras: {
        "Lore-Validation-Status": `${failureKind(node)}-failed`,
        "Lore-Validation-Summary": (
          status.failureReason ?? `${failureKind(node)} run failed`
        ).substring(0, 300),
      },
    };
  }
  const stationResult = parseNodeResult(status.output);

  if (stationResult) {
    return stationResult;
  }

  if (parseReviewVerdict(status.output) === "changes_requested") {
    return { outcome: "changes_requested" };
  }

  return { outcome: "success" };
}
