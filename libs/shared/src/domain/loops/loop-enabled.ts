import { autoReviewEnabled } from "./auto-review-enabled.js";
import { implementationLoopEnabled } from "./implementation-loop-enabled.js";
import type { LoopKey } from "./loop-kinds.js";

/** The issue-triage loop's `issue_triage.enabled` switch (specs/issue-triage FR33): on unless the repository switched it off, so a repository onboarded before the switch existed keeps being triaged. */
export function issueTriageEnabled(rawSettings: unknown): boolean {
  const block = (
    parsedSettings(rawSettings) as {
      issue_triage?: { enabled?: unknown };
    } | null
  )?.issue_triage;

  return block?.enabled !== false;
}

/** The auto-merge loop's switch, `auto_merge.enabled` (specs/protected-branch-merge); off by omission. */
export function autoMergeEnabled(rawSettings: unknown): boolean {
  return autoMergeBlock(rawSettings)?.enabled === true;
}

/** How long a pull request must have been open before the auto-merge loop merges it. */
export const DEFAULT_MIN_AGE_HOURS = 24;

/** `auto_merge.min_age_hours`, or 24 when it is absent or not a whole number of hours of zero or more. */
export function autoMergeMinAgeHours(rawSettings: unknown): number {
  const hours = autoMergeBlock(rawSettings)?.min_age_hours;

  return Number.isInteger(hours) && (hours as number) >= 0
    ? (hours as number)
    : DEFAULT_MIN_AGE_HOURS;
}

function autoMergeBlock(
  rawSettings: unknown,
): { enabled?: unknown; min_age_hours?: unknown } | undefined {
  return (
    parsedSettings(rawSettings) as {
      auto_merge?: { enabled?: unknown; min_age_hours?: unknown };
    } | null
  )?.auto_merge;
}

const ENABLED_BY_KEY: Record<LoopKey, (rawSettings: unknown) => boolean> = {
  implementation: implementationLoopEnabled,
  review: autoReviewEnabled,
  merge: autoMergeEnabled,
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
