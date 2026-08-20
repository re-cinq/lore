// The station contract's outcome parsing (ADR-031 D4/D9): map a terminal Agent
// CR status to the node outcome the transition replay routes on. Precedence on
// Succeeded: the contract's LORE_NODE_RESULT line → the agent review
// REVIEW_RESULT line → success. A CR phase of Failed (crash, non-zero exit, Job
// deadline) is an infrastructure failure, distinct from a station reporting
// outcome "failed" as its normal result. Consumed by the Floor's node-event
// handler + reaper and (parseNodeResult) by the lore-station pod itself.

import { classifyError } from "@re-cinq/lore-shared/error-classify.js";
import type { NodeResult, StageOutcome } from "./node-types.js";

/** The slice of an Agent's status the outcome mapping reacts to. */
export interface AgentNodeStatus {
  phase?: string;
  output?: string;
  failureReason?: string;
  /**
   * The agent's OWN terminal error text, lifted off the raw NDJSON stream before
   * anything unwrapped it (`terminalErrorText`). It has to be carried separately
   * because `output` is normalized at the read boundary, and the unwrapped text
   * no longer parses as a stream — so a reader downstream of the unwrap could
   * only see the Job-level `failureReason`, which says `BackoffLimitExceeded`
   * however the agent actually died.
   */
  errorText?: string;
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

const failureKind = (node: NodeKind): string =>
  node.type === "agent" ? "agent" : "station";

/** All this needs of a node is its TYPE, so a blueprint node and the clone a run
 *  carries both satisfy it without conversion. */
export interface NodeKind {
  type: string;
}

/** Map a terminal Agent status to the node outcome (see precedence above).
 *  The set of outcomes this can return per node type is mirrored by
 *  PRODUCIBLE_OUTCOMES in loader.ts (the load-time edge-coverage check) — keep
 *  the two in sync when adding an outcome. */
export function stationNodeOutcome(
  node: NodeKind,
  status: AgentNodeStatus,
): NodeResult {
  if (status.phase === "Failed") {
    // Precedence is the whole point: the agent's own last words first, the
    // Job-level reason only when it never got to speak. Reading `failureReason`
    // first classified every death as `BackoffLimitExceeded` — which is how a
    // dry Anthropic account reached an author as a retry-budget message.
    const detail = (
      status.errorText ??
      status.failureReason ??
      `${failureKind(node)} run failed`
    ).substring(0, 300);

    return {
      outcome: "failed",
      failureClass: classifyError(detail).category,
      failureDetail: detail,
      extras: {
        "Lore-Validation-Status": `${failureKind(node)}-failed`,
        "Lore-Validation-Summary": detail,
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
