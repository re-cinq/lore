import { describe, it, expect } from "vitest";
import type { AssemblyRunNode } from "@/lib/assembly-run-rows";
import { compareInsight, compareRows, formatDelta } from "./compare-runs";

const visit = (
  nodeId: string,
  durationSeconds: number | null,
): AssemblyRunNode => ({
  nodeId,
  iteration: 1,
  outcome: "success",
  agentCrName: null,
  commitSha: null,
  durationSeconds,
});

describe("compareRows", () => {
  it("sums every visit of a station and lists A's stations before B's own", () => {
    const rows = compareRows(
      [visit("dod", 30), visit("tdd", 60), visit("tdd", 60)],
      [visit("dod", 60), visit("fix-ci", 10)],
    );

    expect(rows.map((r) => [r.station, r.a, r.b])).toEqual([
      ["dod", 30, 60],
      ["tdd", 120, null],
      ["fix-ci", null, 10],
    ]);
  });

  it("scales both bars against the longest station time and leaves the delta out where a run never got", () => {
    const [dod, tdd] = compareRows(
      [visit("dod", 30), visit("tdd", 120)],
      [visit("dod", 60)],
    );

    expect([dod?.aShare, dod?.bShare, dod?.delta]).toEqual([25, 50, -30]);
    expect(tdd?.delta).toBeNull();
  });
});

describe("compareInsight", () => {
  it("names the station with the largest gap and the slower run", () => {
    const rows = compareRows(
      [visit("dod", 30), visit("tdd", 400)],
      [visit("dod", 40), visit("tdd", 100)],
    );

    expect(compareInsight(rows)).toMatch(/^A spent 5m 0s longer at tdd/);
  });

  it("says when the runs never differ", () => {
    expect(
      compareInsight(compareRows([visit("dod", 5)], [visit("dod", 5)])),
    ).toMatch(/same time/);
  });
});

describe("formatDelta", () => {
  it("signs the difference and dashes a missing one", () => {
    expect([formatDelta(42), formatDelta(-65), formatDelta(null)]).toEqual([
      "+42s",
      "−1m 5s",
      "—",
    ]);
  });
});
