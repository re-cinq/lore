import { describe, it, expect } from "vitest";
// web-ui can't import the @re-cinq/lore-shared PACKAGE (workspace + Docker
// isolation), so the onboard guard is hand-duplicated. This CI-only test (runs
// in a full checkout) imports shared's PURE onboard-guard.ts by file path —
// never the package — to keep the mirror in lockstep.
import * as mirror from "./onboard-guard";
import * as canonical from "../../../../libs/shared/src/onboard-guard";

// The whole state space, generated rather than hand-listed: a hand-listed table
// goes stale the moment a branch is added to only one copy, which is exactly the
// drift this test exists to catch.
const STATES = [false, true].flatMap((onboardingPrMerged) =>
  [null, "https://github.com/o/r/pull/7"].flatMap((openOnboardingPrUrl) =>
    [null, "task-1"].map((inFlightTaskId) => ({
      onboardingPrMerged,
      openOnboardingPrUrl,
      inFlightTaskId,
    })),
  ),
);

const REPO_ROWS = [
  undefined,
  {},
  { onboarding_pr_merged: true, onboarding_pr_url: null },
  { onboarding_pr_merged: false, onboarding_pr_url: "https://x/pull/1" },
  { onboarding_pr_merged: true, onboarding_pr_url: "https://x/pull/1" },
];

describe("onboard-guard parity (web-ui mirror vs shared canonical)", () => {
  it.each(STATES)("decides identically for %j", (state) => {
    for (const options of [{}, { reonboard: true }]) {
      expect(mirror.decideOnboard("o/r", state, options)).toEqual(
        canonical.decideOnboard("o/r", state, options),
      );
    }
  });

  it.each(REPO_ROWS)("derives the same state from repo row %j", (repoRow) => {
    for (const taskRow of [undefined, {}, { id: "task-9" }]) {
      expect(mirror.toOnboardState(repoRow, taskRow)).toEqual(
        canonical.toOnboardState(repoRow, taskRow),
      );
    }
  });

  it("shares the advisory-lock key so both apps serialize on it", () => {
    expect(mirror.onboardLockKey("o/r")).toBe(canonical.onboardLockKey("o/r"));
  });

  it("shares the in-flight status set and the task description", () => {
    expect(mirror.IN_FLIGHT_TASK_STATUSES).toEqual(
      canonical.IN_FLIGHT_TASK_STATUSES,
    );
    expect(mirror.onboardTaskDescription("o/r")).toBe(
      canonical.onboardTaskDescription("o/r"),
    );
  });

  it("shares the state-read SQL so the two apps cannot query different rows", () => {
    expect(mirror.ONBOARD_REPO_STATE_SQL).toBe(
      canonical.ONBOARD_REPO_STATE_SQL,
    );
    expect(mirror.ONBOARD_IN_FLIGHT_TASK_SQL).toBe(
      canonical.ONBOARD_IN_FLIGHT_TASK_SQL,
    );
  });

  it("exports the same public surface", () => {
    expect(Object.keys(mirror).sort()).toEqual(Object.keys(canonical).sort());
  });
});
