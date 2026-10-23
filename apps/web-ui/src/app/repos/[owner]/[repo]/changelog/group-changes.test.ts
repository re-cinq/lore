import { describe, it, expect } from "vitest";
import { groupByPerson, weekTitle } from "./group-changes";

const change = (number: number, people: string[]) => ({
  kind: "pr" as const,
  number,
  title: `Change ${number}`,
  url: `https://gh/pr/${number}`,
  people,
  at: "2026-10-21T10:00:00Z",
});

describe("groupByPerson", () => {
  it("lists bob's 1 and 3 and carol's 2 under each, sorted by name, and an issue under both assignees", () => {
    const grouped = groupByPerson([
      change(1, ["bob"]),
      change(2, ["carol", "bob"]),
      change(3, ["bob"]),
    ]);

    expect(
      grouped.map((g) => [g.person, g.changes.map((c) => c.number)]),
    ).toEqual([
      ["bob", [1, 2, 3]],
      ["carol", [2]],
    ]);
  });

  it("puts a change with nobody under unassigned", () => {
    expect(groupByPerson([change(4, [])]).map((g) => g.person)).toEqual([
      "unassigned",
    ]);
  });
});

describe("weekTitle", () => {
  it("returns Week 43 · 19 Oct – 25 Oct for 2026-W43", () => {
    expect(
      weekTitle({
        weekKey: "2026-W43",
        from: "2026-10-19T00:00:00.000Z",
        to: "2026-10-26T00:00:00.000Z",
      }),
    ).toBe("Week 43 · 19 Oct – 25 Oct");
  });
});
