import { describe, it, expect } from "vitest";
import { closedIssue, mergedPr } from "../digest/fixtures.js";
import { finishedWeeks, isoWeekBounds, weekChanges } from "./changelog-week.js";

const W43 = {
  from: "2026-10-19T00:00:00.000Z",
  to: "2026-10-26T00:00:00.000Z",
};

describe("isoWeekBounds", () => {
  it("returns Monday 2026-10-19 to Monday 2026-10-26 for 2026-W43", () => {
    expect(isoWeekBounds("2026-W43")).toEqual(W43);
  });

  it("returns Monday 2026-12-28 to Monday 2027-01-04 for 2026-W53", () => {
    expect(isoWeekBounds("2026-W53")).toEqual({
      from: "2026-12-28T00:00:00.000Z",
      to: "2027-01-04T00:00:00.000Z",
    });
  });
});

describe("finishedWeeks", () => {
  it("returns 2026-W43 and 2026-W42 on Monday 2026-10-26 at 06:00Z", () => {
    expect(finishedWeeks(new Date("2026-10-26T06:00:00Z"), 2)).toEqual([
      "2026-W43",
      "2026-W42",
    ]);
  });

  it("returns 2026-W53 on Monday 2027-01-04", () => {
    expect(finishedWeeks(new Date("2027-01-04T06:00:00Z"), 1)).toEqual([
      "2026-W53",
    ]);
  });
});

describe("weekChanges", () => {
  it("lists a merged PR under its author and a closed issue under its assignees, newest first", () => {
    const changes = weekChanges(
      {
        merged: [mergedPr({ number: 1, mergedAt: "2026-10-20T10:00:00Z" })],
        closed: [
          closedIssue({
            number: 12,
            assignees: ["carol", "dan"],
            closedAt: "2026-10-21T10:00:00Z",
          }),
        ],
      },
      W43,
    );

    expect(changes).toEqual([
      {
        kind: "issue",
        number: 12,
        title: "An issue",
        url: "https://gh/i/12",
        people: ["carol", "dan"],
        at: "2026-10-21T10:00:00Z",
      },
      {
        kind: "pr",
        number: 1,
        title: "A change",
        url: "https://gh/pr/1",
        people: ["alice"],
        at: "2026-10-20T10:00:00Z",
      },
    ]);
  });

  it("leaves out a PR merged at Monday 2026-10-26 00:00Z, the start of the next week", () => {
    expect(
      weekChanges(
        {
          merged: [mergedPr({ mergedAt: "2026-10-26T00:00:00.000Z" })],
          closed: [],
        },
        W43,
      ),
    ).toEqual([]);
  });

  it("lists issue 12 once, as the PR that closes it", () => {
    const changes = weekChanges(
      {
        merged: [
          mergedPr({ body: "Closes #12", mergedAt: "2026-10-20T10:00:00Z" }),
        ],
        closed: [closedIssue({ number: 12, closedAt: "2026-10-20T10:00:00Z" })],
      },
      W43,
    );

    expect(changes.map((c) => [c.kind, c.number])).toEqual([["pr", 1]]);
  });
});
