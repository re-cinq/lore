// Station contract's outcome parsing (ADR-031 D4/D9): maps a terminal Agent CR status to the node outcome the transition replay routes on. Precedence on Succeeded: LORE_NODE_RESULT → REVIEW_RESULT → success; a CR phase of Failed is a distinct infrastructure failure.

import { classifyError } from "@re-cinq/lore-shared/error-classify.js";
import type { FailureCategory } from "@re-cinq/lore-shared/error-classify.js";
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

function parseJsonPayload(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    return undefined;
  }
}

function stringExtrasOf(
  extras: Record<string, unknown> | undefined,
): Record<string, string> {
  const stringExtras: Record<string, string> = {};

  for (const [key, value] of Object.entries(extras ?? {})) {
    if (typeof value === "string") {
      stringExtras[key] = value;
    }
  }

  return stringExtras;
}

function nodeResultFromJson(payload: string): NodeResult | null {
  const parsed = parseJsonPayload(payload);

  if (parsed === undefined) {
    return null;
  }
  const { outcome, extras } = parsed as {
    outcome?: string;
    extras?: Record<string, unknown>;
  };

  if (!OUTCOMES.has(outcome as StageOutcome)) {
    return null;
  }

  return { outcome: outcome as StageOutcome, extras: stringExtrasOf(extras) };
}

function nodeResultFromPayload(payload: string): NodeResult | null {
  // The bare word is legacy but LIVE: a deployed recipe instructs exactly it; rejecting it turned a station's objection into a silent success (#1469).
  if (OUTCOMES.has(payload as StageOutcome)) {
    return { outcome: payload as StageOutcome, extras: {} };
  }

  return nodeResultFromJson(payload);
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

function liftedValidationDetail(stationResult: NodeResult): string | null {
  const failedSuites = stationResult.extras?.["Lore-Validation-Failed"];

  if (!failedSuites) {
    return null;
  }
  const failureOutput = stationResult.extras?.["Lore-Validation-Output"];

  return failureOutput
    ? `validation failed: ${failedSuites}\n\n${failureOutput}`
    : `validation failed: ${failedSuites}`;
}

// The validate station reports dead suites only via extras; lift that into failureDetail (with the commands' own output when sent) so the terminal reason names it — "lint,build failed" says where, the output says what to fix.
function withValidationFailureDetail(stationResult: NodeResult): NodeResult {
  if (stationResult.outcome !== "failed" || stationResult.failureDetail) {
    return stationResult;
  }
  const failureDetail = liftedValidationDetail(stationResult);

  return failureDetail ? { ...stationResult, failureDetail } : stationResult;
}

// A terminal, classified infrastructure failure — the CR-Failed and unparseable-marker cases share this exact shape.
function infraFailureResult(
  node: NodeKind,
  detail: string,
  failureClass: FailureCategory,
): NodeResult {
  return {
    outcome: "failed",
    failureClass,
    failureDetail: detail,
    extras: {
      "Lore-Validation-Status": `${failureKind(node)}-failed`,
      "Lore-Validation-Summary": detail,
    },
  };
}

// Precedence: agent's own last words first, Job-level reason only when it never spoke. `||` not `??`: an EMPTY error string must not win over the Job-level reason — "said nothing" is not "spoke".
function failedPhaseDetail(node: NodeKind, status: AgentNodeStatus): string {
  return (
    status.errorText ||
    status.failureReason ||
    `${failureKind(node)} run failed`
  ).substring(0, 300);
}

// Spoken but misheard: falling through to the default made an agent's objection a `success`, skipping the human decision point its edge exists for (#1469).
function stationOutputOutcome(
  node: NodeKind,
  output: string | undefined,
): NodeResult {
  const stationResult = parseNodeResult(output);

  if (stationResult) {
    return withValidationFailureDetail(stationResult);
  }

  const malformed = malformedNodeResultLine(output);

  if (malformed) {
    const detail = `unparseable LORE_NODE_RESULT line: ${malformed}`.substring(
      0,
      300,
    );

    // Not a classified infrastructure failure: a recipe/contract bug, and `unknown` never trips the account-wide dispatch gate.
    return infraFailureResult(node, detail, "unknown");
  }

  return parseReviewVerdict(output) === "changes_requested"
    ? { outcome: "changes_requested" }
    : { outcome: "success" };
}

// Maps a terminal Agent status to the node outcome (precedence above); mirrored by PRODUCIBLE_OUTCOMES in loader.ts — keep both in sync when adding an outcome.
export function stationNodeOutcome(
  node: NodeKind,
  status: AgentNodeStatus,
): NodeResult {
  if (status.phase === "Failed") {
    const detail = failedPhaseDetail(node, status);

    return infraFailureResult(node, detail, classifyError(detail).category);
  }

  return stationOutputOutcome(node, status.output);
}
