// What the attempt column shows for one attempt, by the family of the node's station (run-viz FR4.1i). Only an agent leaves a transcript and logs; a service reports and may call a model; a person's visit only waits and is answered; a marker passes at once.
import type { NodeTypeFamily } from "./node-type-family";

export interface AttemptSections {
  showSelect: boolean;
  transcript: boolean;
  outcome: boolean;
  human: boolean;
  produced: boolean;
  modelCalls: boolean;
  timing: boolean;
  events: boolean;
  needs: boolean;
  input: boolean;
}

export interface AttemptFacts {
  produced?: Record<string, string> | null;
  needs?: Record<string, string> | null;
  input?: unknown;
}

const NONE: AttemptSections = {
  showSelect: false,
  transcript: false,
  outcome: false,
  human: false,
  produced: false,
  modelCalls: false,
  timing: false,
  events: true,
  needs: false,
  input: false,
};

const BY_FAMILY: Record<NodeTypeFamily, Partial<AttemptSections>> = {
  agent: {
    showSelect: true,
    transcript: true,
    modelCalls: true,
    needs: true,
    input: true,
  },
  service: {
    outcome: true,
    modelCalls: true,
    timing: true,
    needs: true,
    input: true,
  },
  person: { human: true, needs: true },
  marker: { outcome: true, timing: true },
};

export function attemptSections(
  family: NodeTypeFamily,
  attempt: AttemptFacts,
): AttemptSections {
  const sections = { ...NONE, ...BY_FAMILY[family] };

  return {
    ...sections,
    produced: hasEntries(attempt.produced),
    // A marker is handed nothing as a rule; it shows its needs or input only when it was.
    needs: sections.needs || hasEntries(attempt.needs),
    input: sections.input || (attempt.input ?? null) !== null,
  };
}

function hasEntries(
  record: Record<string, string> | null | undefined,
): boolean {
  return Object.keys(record ?? {}).length > 0;
}
