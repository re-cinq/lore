import { describe, it, expect } from "vitest";
import { formatTrailers } from "@re-cinq/lore-shared";
import { buildTimeline } from "./task-timeline.js";

function commit(sha: string, message: string, date: string | null) {
  return { sha, commit: { message, committer: date === null ? null : { date } } };
}

const T0 = "2026-01-01T00:00:00.000Z";

describe("buildTimeline", () => {
  it("returns empty array when no commits carry trailers", () => {
    const commits = [commit("a", "no trailers here", "2026-01-01T00:01:00.000Z")];
    expect(buildTimeline(commits, new Date(T0))).toEqual([]);
  });

  it("reverses GitHub newest-first order into chronological stages", () => {
    const second = commit(
      "s2",
      `second\n\n${formatTrailers({ stage: "implement", iteration: 1, taskId: "t-1" })}`,
      "2026-01-01T00:02:00.000Z",
    );
    const first = commit(
      "s1",
      `first\n\n${formatTrailers({ stage: "plan", iteration: 0, taskId: "t-1" })}`,
      "2026-01-01T00:01:00.000Z",
    );
    // GitHub returns most-recent-first.
    const result = buildTimeline([second, first], new Date(T0));
    expect(result.map((c) => c.stage)).toEqual(["plan", "implement"]);
    expect(result.map((c) => c.sha)).toEqual(["s1", "s2"]);
  });

  it("computes per-stage duration from the previous commit time", () => {
    const first = commit(
      "s1",
      `first\n\n${formatTrailers({ stage: "plan", iteration: 0, taskId: "t-1" })}`,
      "2026-01-01T00:01:00.000Z",
    );
    const second = commit(
      "s2",
      `second\n\n${formatTrailers({ stage: "implement", iteration: 1, taskId: "t-1" })}`,
      "2026-01-01T00:02:00.000Z",
    );
    const result = buildTimeline([second, first], new Date(T0));
    expect(result[0].duration_ms).toBe(60_000); // 00:01 - 00:00
    expect(result[1].duration_ms).toBe(60_000); // 00:02 - 00:01
  });

  it("defaults outcome to success and surfaces Lore-Outcome extras", () => {
    const c = commit(
      "s1",
      `done\n\n${formatTrailers({ stage: "retrospective", iteration: 2, taskId: "t-1", extras: { "Lore-Outcome": "failed" } })}`,
      "2026-01-01T00:05:00.000Z",
    );
    const [entry] = buildTimeline([c], new Date(T0));
    expect(entry).toMatchObject({
      stage: "retrospective",
      iteration: 2,
      outcome: "failed",
      summary: "done",
      extras: { "Lore-Outcome": "failed" },
    });
  });

  it("filters non-trailer commits while keeping trailered ones", () => {
    const noise = commit("noise", "chore: tidy", "2026-01-01T00:03:00.000Z");
    const real = commit(
      "real",
      `feat\n\n${formatTrailers({ stage: "plan", iteration: 0, taskId: "t-1" })}`,
      "2026-01-01T00:04:00.000Z",
    );
    const result = buildTimeline([noise, real], new Date(T0));
    expect(result.map((c) => c.sha)).toEqual(["real"]);
  });
});
