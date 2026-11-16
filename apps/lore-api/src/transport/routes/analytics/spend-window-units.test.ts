import { describe, expect, it } from "vitest";
import { unitCostReads } from "./spend-window-units.js";
import {
  REVIEW_PR_COSTS_SQL,
  TICKET_COSTS_SQL,
} from "./spend-window-units-sql.js";

const window = {
  interval: { from: "2026-11-01", to: "2026-11-08" },
  fromTs: "2026-11-01T00:00:00Z",
  toTs: "2026-11-08T00:00:00Z",
};

describe("unitCostReads", () => {
  it("binds https://github.com to the ticket and pull request reads and its pattern to the ticket read when the host is github.com", () => {
    expect(
      unitCostReads(window, "github.com").map(({ params }) => params),
    ).toEqual([
      [
        window.fromTs,
        window.toTs,
        "https://github.com",
        "https://github\\.com",
      ],
      [window.fromTs, window.toTs, "https://github.com"],
      [window.fromTs, window.toTs],
      [window.fromTs, window.toTs],
      [window.fromTs, window.toTs],
    ]);
  });

  it("binds https://ghe.example.com and its pattern for host ghe.example.com", () => {
    expect(unitCostReads(window, "ghe.example.com")[0].params).toEqual([
      window.fromTs,
      window.toTs,
      "https://ghe.example.com",
      "https://ghe\\.example\\.com",
    ]);
  });

  it("binds exactly as many values as the highest placeholder of each read for host ghe.example.com", () => {
    const highestPlaceholder = (sql: string) =>
      Math.max(
        ...[...sql.matchAll(/\$(\d+)/g)].map(([, index]) => Number(index)),
      );

    expect(
      unitCostReads(window, "ghe.example.com").map(({ sql, params }) => [
        params.length,
        highestPlaceholder(sql),
      ]),
    ).toEqual([
      [4, 4],
      [3, 3],
      [2, 2],
      [2, 2],
      [2, 2],
    ]);
  });

  it("keeps the host out of the ticket and pull request sql text", () => {
    expect([TICKET_COSTS_SQL, REVIEW_PR_COSTS_SQL].join("\n")).not.toContain(
      "github.com",
    );
  });
});
