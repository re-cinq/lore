import { describe, expect, it } from "vitest";
import {
  capSections,
  recentWindow,
  SectionLimitsQuery,
} from "./loop-sections.js";

const rows = (n: number) => Array.from({ length: n }, (_, at) => at + 1);

describe("capSections", () => {
  it("keeps all 9 current rows and cuts 9 recent rows to 6 for a limit of 5, the sixth telling the page there is more", () => {
    const capped = capSections(
      {
        current: rows(9),
        backlog: rows(2),
        parked: rows(9),
        awaiting_merge: [],
        recent: rows(9),
      },
      { recent: 5, parked: 10 },
    );

    expect(capped).toEqual({
      current: rows(9),
      backlog: rows(2),
      parked: rows(9),
      awaiting_merge: [],
      recent: rows(6),
    });
  });

  it("cuts nothing when no limit is asked, as for a caller that predates the limits", () => {
    const sections = {
      current: rows(3),
      backlog: rows(30),
      parked: [],
      awaiting_merge: [],
      recent: rows(12),
    };

    expect(capSections(sections, {})).toEqual(sections);
  });

  it("reads limits of 5 and 10 from the query strings, and refuses 0 and 1000", () => {
    expect([
      SectionLimitsQuery.safeParse({ recent: "5", backlog: "10" }).data,
      SectionLimitsQuery.safeParse({ recent: "0" }).success,
      SectionLimitsQuery.safeParse({ parked: "1000" }).success,
    ]).toEqual([{ recent: 5, backlog: 10 }, false, false]);
  });
});

describe("recentWindow", () => {
  it("gathers 10 recent rows when the page asks for none, 16 for ?recent=15, and still 10 for ?recent=3", () => {
    expect([
      recentWindow({}, 10),
      recentWindow({ recent: 15 }, 10),
      recentWindow({ recent: 3 }, 10),
    ]).toEqual([10, 16, 10]);
  });
});
