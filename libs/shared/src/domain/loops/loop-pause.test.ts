import { describe, expect, it } from "vitest";
import { autoReviewEnabled } from "./auto-review-enabled.js";
import { implementationLoopEnabled } from "./implementation-loop-enabled.js";
import { loopEnabled, loopSwitchedOn } from "./loop-enabled.js";
import { loopPause, pauseActive } from "./loop-pause.js";

const creditPause = {
  reason: "model credit exhausted",
  run_id: "run-1",
  at: "2026-10-30T10:00:00.000Z",
  until: null,
};

describe("loopPause", () => {
  it("returns the implementation pause stored under loop_pauses", () => {
    expect(
      loopPause("implementation", {
        loop_pauses: { implementation: creditPause },
      }),
    ).toEqual(creditPause);
  });

  it("returns null when the loop has no pause", () => {
    expect(loopPause("review", { loop_pauses: {} })).toBeNull();
    expect(loopPause("review", null)).toBeNull();
  });

  it("returns null for a pause without a reason", () => {
    expect(
      loopPause("review", { loop_pauses: { review: { at: "x" } } }),
    ).toBeNull();
  });

  it("reads a settings column handed over as a JSON string", () => {
    expect(
      loopPause(
        "triage",
        JSON.stringify({ loop_pauses: { triage: creditPause } }),
      ),
    ).toEqual(creditPause);
  });
});

describe("pauseActive", () => {
  const now = new Date("2026-10-30T12:00:00.000Z");

  it("returns false when there is no pause", () => {
    expect(pauseActive(null, now)).toBe(false);
  });

  it("returns true for a pause with no end", () => {
    expect(pauseActive(creditPause, now)).toBe(true);
  });

  it("returns true until 13:00 and false after it", () => {
    const timed = { ...creditPause, until: "2026-10-30T13:00:00.000Z" };

    expect(pauseActive(timed, now)).toBe(true);
    expect(pauseActive(timed, new Date("2026-10-30T13:00:01.000Z"))).toBe(
      false,
    );
  });
});

describe("a paused loop", () => {
  const switchedOn = {
    implementation_loop: { enabled: true },
    auto_review: true,
    loop_pauses: { implementation: creditPause, review: creditPause },
  };

  it("reads implementationLoopEnabled false while its switch stays on", () => {
    expect(implementationLoopEnabled(switchedOn)).toBe(false);
    expect(loopSwitchedOn("implementation", switchedOn)).toBe(true);
  });

  it("reads autoReviewEnabled false", () => {
    expect(autoReviewEnabled(switchedOn)).toBe(false);
  });

  it("reads triage false and spec upkeep true when only triage is paused", () => {
    const settings = { loop_pauses: { triage: creditPause } };

    expect(loopEnabled("triage", settings)).toBe(false);
    expect(loopEnabled("upkeep", settings)).toBe(true);
  });

  it("reads true again once a pause that ended in 2020 has passed", () => {
    const settings = {
      implementation_loop: { enabled: true },
      loop_pauses: {
        implementation: { ...creditPause, until: "2020-01-01T00:00:00.000Z" },
      },
    };

    expect(implementationLoopEnabled(settings)).toBe(true);
  });
});
