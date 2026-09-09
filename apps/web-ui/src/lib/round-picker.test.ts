import { describe, it, expect } from "vitest";
import { isRewind, lineageLabel, rewindOptions } from "./round-picker";
import type { FeatureIterationRow } from "./feature-types";

const round = (over: Partial<FeatureIterationRow> & { iteration: number }) =>
  ({
    id: `it-${over.iteration}`,
    feature_id: "f1",
    task_id: `t-${over.iteration}`,
    status: "ready",
    user_answers: null,
    gap_result: { sections: [], draft_spec_markdown: "d" },
    parent_iteration: null,
    created_at: "2026-08-11T00:00:00Z",
    ...over,
  }) as FeatureIterationRow;

describe("rewindOptions", () => {
  it("lists the rounds newest first and marks the latest", () => {
    const options = rewindOptions([
      round({ iteration: 1 }),
      round({ iteration: 2 }),
    ]);

    expect(options.map((o) => o.label)).toEqual([
      "Round 2 (latest)",
      "Round 1",
    ]);
  });

  it("offers no round that produced nothing to continue from", () => {
    const options = rewindOptions([
      round({ iteration: 1 }),
      round({ iteration: 2, status: "failed", gap_result: null }),
    ]);

    expect(options.map((o) => o.iteration)).toEqual([1]);
  });

  it("marks the newest SURVIVING round as the latest, not the newest attempt", () => {
    const options = rewindOptions([
      round({ iteration: 1 }),
      round({ iteration: 2 }),
      round({ iteration: 3, status: "running", gap_result: null }),
    ]);

    expect(options[0].label).toBe("Round 2 (latest)");
  });

  it("offers nothing before the first round lands", () => {
    expect(
      rewindOptions([
        round({ iteration: 1, status: "running", gap_result: null }),
      ]),
    ).toEqual([]);
  });
});

describe("lineageLabel", () => {
  it("names the round a fork descends from", () => {
    expect(lineageLabel({ iteration: 5, label: "Round 5", parent: 2 })).toBe(
      "forked from round 2",
    );
  });

  it("says nothing when a round simply followed the one before it", () => {
    expect(
      lineageLabel({ iteration: 5, label: "Round 5", parent: 4 }),
    ).toBeNull();
  });

  it("says nothing for a round with no recorded parent", () => {
    expect(
      lineageLabel({ iteration: 5, label: "Round 5", parent: null }),
    ).toBeNull();
  });
});

describe("isRewind", () => {
  const options = [
    { iteration: 4, label: "Round 4 (latest)", parent: null },
    { iteration: 2, label: "Round 2", parent: null },
  ];

  it("true when the author picked an earlier round", () => {
    expect(isRewind(options, 2)).toBe(true);
  });

  it("false when the author picked the latest", () => {
    expect(isRewind(options, 4)).toBe(false);
  });

  it("false when the author picked nothing", () => {
    expect(isRewind(options, undefined)).toBe(false);
  });

  it("false before any round exists to rewind to", () => {
    expect(isRewind([], 2)).toBe(false);
  });
});
