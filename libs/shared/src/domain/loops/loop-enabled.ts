import { implementationLoopEnabled } from "./implementation-loop-enabled.js";
import type { LoopKey } from "./loop-kinds.js";

/** The issue-triage loop's `issue_triage.enabled` switch (specs/issue-triage FR33): on unless the repository switched it off, so a repository onboarded before the switch existed keeps being triaged. */
export function issueTriageEnabled(rawSettings: unknown): boolean {
  const block = (
    parsedSettings(rawSettings) as { issue_triage?: { enabled?: unknown } } | null
  )?.issue_triage;

  return block?.enabled !== false;
}

const ENABLED_BY_KEY: Record<LoopKey, (rawSettings: unknown) => boolean> = {
  implementation: implementationLoopEnabled,
  triage: issueTriageEnabled,
};

/** Whether the named loop is switched on for a repository, read from its raw `lore.repos.settings`. */
export function loopEnabled(key: LoopKey, rawSettings: unknown): boolean {
  return ENABLED_BY_KEY[key](rawSettings);
}

function parsedSettings(raw: unknown): unknown {
  if (typeof raw !== "string") {
    return raw;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
