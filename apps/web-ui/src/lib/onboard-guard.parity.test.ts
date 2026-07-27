import { describe, it, expect } from "vitest";
// web-ui can't import the @re-cinq/lore-shared PACKAGE (workspace + Docker
// isolation), so the onboard guard is hand-duplicated. This CI-only test (runs
// in a full checkout) imports shared's PURE onboard-guard.ts by file path —
// never the package — to keep the mirror in lockstep.
import * as mirror from "./onboard-guard";
import * as canonical from "../../../../libs/shared/src/onboard-guard";

const STATES = [
  {
    onboardingPrMerged: false,
    openOnboardingPrUrl: null,
    inFlightTaskId: null,
  },
  {
    onboardingPrMerged: false,
    openOnboardingPrUrl: null,
    inFlightTaskId: "task-1",
  },
  { onboardingPrMerged: true, openOnboardingPrUrl: null, inFlightTaskId: null },
  {
    onboardingPrMerged: true,
    openOnboardingPrUrl: null,
    inFlightTaskId: "task-2",
  },
  {
    onboardingPrMerged: false,
    openOnboardingPrUrl: "https://github.com/o/r/pull/7",
    inFlightTaskId: null,
  },
];

describe("onboard-guard parity (web-ui mirror vs shared canonical)", () => {
  it.each(STATES)("decides identically for %j", (state) => {
    for (const options of [{}, { reonboard: true }]) {
      expect(mirror.decideOnboard("o/r", state, options)).toEqual(
        canonical.decideOnboard("o/r", state, options),
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
});
