// Hand mirror of libs/assembly-lines/src/node-outcome.ts's parseNodeResult (web-ui can't import libs/): the LAST line-start `LORE_NODE_RESULT:` marker decides, a bare outcome word is legacy but live, extras keep string values only. The transcript lifts that line out of the prose so the node's verdict reads as a card, not a buried JSON string.
import { isRecord } from "./agent-log-format";

const MARKER = /^LORE_NODE_RESULT:[ \t]*(.*)$/gm;
const OUTCOMES = ["success", "changes_requested", "failed"] as const;

export type NodeOutcome = (typeof OUTCOMES)[number];

export type NodeResultLine =
  | { valid: true; outcome: NodeOutcome; extras: Record<string, string> }
  | { valid: false; payload: string };

export interface SplitNodeResult {
  prose: string;
  nodeResult: NodeResultLine | null;
}

export function splitNodeResult(text: string): SplitNodeResult {
  const last = [...text.matchAll(MARKER)].at(-1);

  if (last === undefined) {
    return { prose: text, nodeResult: null };
  }
  const prose =
    text.slice(0, last.index) + text.slice(last.index + last[0].length);

  return { prose: prose.trim(), nodeResult: nodeResultOf(last[1].trim()) };
}

function nodeResultOf(payload: string): NodeResultLine {
  if (isOutcome(payload)) {
    return { valid: true, outcome: payload, extras: {} };
  }
  const parsed = parsedPayload(payload);

  if (!isRecord(parsed) || !isOutcome(parsed.outcome)) {
    return { valid: false, payload };
  }

  return {
    valid: true,
    outcome: parsed.outcome,
    extras: stringExtrasOf(parsed.extras),
  };
}

function isOutcome(value: unknown): value is NodeOutcome {
  return OUTCOMES.includes(value as NodeOutcome);
}

function parsedPayload(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    return undefined;
  }
}

function stringExtrasOf(extras: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(isRecord(extras) ? extras : {}).filter(
      (pair): pair is [string, string] => typeof pair[1] === "string",
    ),
  );
}
