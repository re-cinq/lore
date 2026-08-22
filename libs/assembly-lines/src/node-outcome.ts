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
 * The payload of the LAST line-start `LORE_NODE_RESULT:` marker, or null.
 *
 * Line-start and last-wins together are what make the marker safe to DISCUSS: an
 * agent quoting its own contract mid-sentence decides nothing, and one that
 * explains the marker and then prints it is read by its final word. The payload is
 * one physical line — the contract's own shape, and all `JSON.parse` accepts here.
 */
function lastNodeResultPayload(output?: string): string | null {
  const matches = [
    ...(output ?? "").matchAll(/^LORE_NODE_RESULT:[ \t]*(.*)$/gm),
  ];

  return matches.length ? matches[matches.length - 1][1].trim() : null;
}

function nodeResultFromPayload(payload: string): NodeResult | null {
  // The bare word is legacy but LIVE: a deployed recipe instructs exactly it, and
  // rejecting it turned a station's objection into a silent success (#1469).
  if (OUTCOMES.has(payload as StageOutcome)) {
    return { outcome: payload as StageOutcome, extras: {} };
  }
  let parsed: unknown;

  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  const { outcome, extras } = parsed as {
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
 * The station contract's terminal line: `LORE_NODE_RESULT: {"outcome": ...,
 * "extras": {...}}`, or the legacy bare word. Null on absence or malformation —
 * a malformed line is not a formatting slip to shrug off, though: see
 * {@link malformedNodeResultLine}, which is how the node fails instead.
 */
export function parseNodeResult(output?: string): NodeResult | null {
  const payload = lastNodeResultPayload(output);

  return payload === null ? null : nodeResultFromPayload(payload);
}

/**
 * The offending line when a marker is PRESENT but says nothing usable.
 *
 * The `success` default exists for an agent that prints NO marker. An agent that
 * printed one and was misheard is a different thing entirely — that is the
 * failure this surfaces, so a recipe whose contract has drifted reports itself
 * instead of passing every node.
 */
export function malformedNodeResultLine(output?: string): string | null {
  const payload = lastNodeResultPayload(output);

  if (payload === null || nodeResultFromPayload(payload) !== null) {
    return null;
  }

  return `LORE_NODE_RESULT: ${payload}`.substring(0, 200);
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
    //
    // `||`, not `??`: `terminalErrorText` answers `parsed.result` for any line
    // with `is_error`, and an agent that errors with an EMPTY result string
    // would otherwise win the precedence with nothing to say — classifying as
    // `unknown`, emitting an empty summary, and discarding the Job-level reason
    // that was the only information anyone had. "Said nothing" is not "spoke".
    const detail = (
      status.errorText ||
      status.failureReason ||
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

  // Spoken but misheard. Falling through to the default made an agent's objection
  // a `success` and skipped the human decision point its edge exists for (#1469) —
  // and the recipe bug behind it left no trace anywhere.
  const malformed = malformedNodeResultLine(status.output);

  if (malformed) {
    const detail = `unparseable LORE_NODE_RESULT line: ${malformed}`.substring(
      0,
      300,
    );

    return {
      outcome: "failed",
      // Not a classified infrastructure failure: this is a recipe/contract bug, and
      // `unknown` is the class that never trips the account-wide dispatch gate.
      failureClass: "unknown",
      failureDetail: detail,
      extras: {
        "Lore-Validation-Status": `${failureKind(node)}-failed`,
        "Lore-Validation-Summary": detail,
      },
    };
  }

  if (parseReviewVerdict(status.output) === "changes_requested") {
    return { outcome: "changes_requested" };
  }

  return { outcome: "success" };
}
