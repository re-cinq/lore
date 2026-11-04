import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { costsByRunOf } from "./floor-costs.js";

type Filter = Record<string, string>;

function runsFrom(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `run-${index + 1}`,
    createdAt: new Date(Date.UTC(2026, 9, 1 + index)),
  }));
}

function costsFloor(failing: string[] = []) {
  const filters: Filter[] = [];
  const summary = async (filter: Filter) => {
    filters.push(filter);

    enforceTrue(!(failing.includes(filter.run)), Error, `floor costs: 503 for ${filter.run}`);

    return filter.run
      ? [{ key: filter.run, costUsd: Number(filter.run.slice(4)) }]
      : [{ key: "run-1", costUsd: 1 }];
  };

  return { costs: { summary } as never, filters };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("costsByRunOf", () => {
  it("reads 2 runs with one { run } read each", async () => {
    const { costs, filters } = costsFloor();

    const byRun = await costsByRunOf(costs, runsFrom(2));

    expect([filters, [...byRun]]).toEqual([
      [{ run: "run-1" }, { run: "run-2" }],
      [
        ["run-1", 1],
        ["run-2", 2],
      ],
    ]);
  });

  it("reads 11 runs with one { since } read from the oldest", async () => {
    const { costs, filters } = costsFloor();

    await costsByRunOf(costs, runsFrom(11));

    expect(filters).toEqual([{ since: "2026-10-01T00:00:00.000Z" }]);
  });

  it("makes no read for no runs", async () => {
    const { costs, filters } = costsFloor();

    const byRun = await costsByRunOf(costs, []);

    expect([filters, byRun.size]).toEqual([[], 0]);
  });

  it("drops only run-2's cost when its read fails, and warns once naming the floor error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { costs } = costsFloor(["run-2"]);

    const byRun = await costsByRunOf(costs, runsFrom(3));

    expect([[...byRun], warn.mock.calls]).toEqual([
      [
        ["run-1", 1],
        ["run-3", 3],
      ],
      [["[floor-runs] 1 of 3 cost reads failed: floor costs: 503 for run-2"]],
    ]);
  });
});
