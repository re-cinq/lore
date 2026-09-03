// Station contract's outcome parsing (ADR-031 D4/D9): maps a terminal Agent CR status to the node outcome the transition replay routes on. Precedence on Succeeded: LORE_NODE_RESULT → REVIEW_RESULT → success; a CR phase of Failed is a distinct infrastructure failure.

import { classifyError } from "@re-cinq/lore-shared/error-classify.js";
import type { NodeResult, StageOutcome } from "./node-types.js";

// The slice of an Agent's status the outcome mapping reacts to.
export type { AgentNodeStatus } from "@re-cinq/lore-shared/cluster/agent-node-status.js";
import type { AgentNodeStatus } from "@re-cinq/lore-shared/cluster/agent-node-status.js";

const OUTCOMES = new Set<StageOutcome>([
  "success",
  "changes_requested",
  "failed",
]);

// Review nodes ask the agent to print exactly one REVIEW_RESULT line.
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

// Payload of the LAST line-start `LORE_NODE_RESULT:` marker, or null — line-start + last-wins together make the marker safe to DISCUSS (an agent quoting it mid-sentence decides nothing; one printing it after explaining it is read by its final word).
function lastNodeResultPayload(output?: string): string | null {
  const matches = [
    ...(output ?? "").matchAll(/^LORE_NODE_RESULT:[ \t]*(.*)$/gm),
  ];

  return matches.length ? matches[matches.length - 1][1].trim() : null;
}

function nodeResultFromPayload(payload: string): NodeResult | null {
  // The bare word is legacy but LIVE: a deployed recipe instructs exactly it; rejecting it turned a station's objection into a silent success (#1469).
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

// Station contract's terminal line (LORE_NODE_RESULT JSON or legacy bare word); null on absence or malformation — see malformedNodeResultLine, which is how the node fails instead.
export function parseNodeResult(output?: string): NodeResult | null {
  const payload = lastNodeResultPayload(output);

  return payload === null ? null : nodeResultFromPayload(payload);
}

// The offending line when a marker is PRESENT but unusable — distinct from the `success` default for no marker at all, so a drifted recipe contract reports itself instead of passing every node.
export function malformedNodeResultLine(output?: string): string | null {
  const payload = lastNodeResultPayload(output);

  if (payload === null || nodeResultFromPayload(payload) !== null) {
    return null;
  }

  return `LORE_NODE_RESULT: ${payload}`.substring(0, 200);
}

const failureKind = (node: NodeKind): string =>
  node.type === "agent" ? "agent" : "station";

// All this needs of a node is its TYPE, so a blueprint node and the clone a run carries both satisfy it without conversion.
export interface NodeKind {
  type: string;
}

// The validate station reports dead suites only via extras; lift that into failureDetail (with the commands' own output when sent) so the terminal reason names it — "lint,build failed" says where, the output says what to fix.
function withValidationFailureDetail(stationResult: NodeResult): NodeResult {
  const failedSuites = stationResult.extras?.["Lore-Validation-Failed"];
  const failureOutput = stationResult.extras?.["Lore-Validation-Output"];
  const needsLiftedDetail =
    stationResult.outcome === "failed" && !stationResult.failureDetail;

  if (needsLiftedDetail && failedSuites) {
    return {
      ...stationResult,
      failureDetail: failureOutput
        ? `validation failed: ${failedSuites}\n\n${failureOutput}`
        : `validation failed: ${failedSuites}`,
    };
  }

  return stationResult;
}

// Maps a terminal Agent status to the node outcome (precedence above); mirrored by PRODUCIBLE_OUTCOMES in loader.ts — keep both in sync when adding an outcome.
export function stationNodeOutcome(
  node: NodeKind,
  status: AgentNodeStatus,
): NodeResult {
  if (status.phase === "Failed") {
    // Precedence: agent's own last words first, Job-level reason only when it never spoke (reading failureReason first classified every death as BackoffLimitExceeded, e.g. a dry Anthropic account). `||` not `??`: an EMPTY error string must not win over the Job-level reason — "said nothing" is not "spoke".
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
    return withValidationFailureDetail(stationResult);
  }

  // Spoken but misheard: falling through to the default made an agent's objection a `success`, skipping the human decision point its edge exists for (#1469).
  const malformed = malformedNodeResultLine(status.output);

  if (malformed) {
    const detail = `unparseable LORE_NODE_RESULT line: ${malformed}`.substring(
      0,
      300,
    );

    return {
      outcome: "failed",
      // Not a classified infrastructure failure: a recipe/contract bug, and `unknown` never trips the account-wide dispatch gate.
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
