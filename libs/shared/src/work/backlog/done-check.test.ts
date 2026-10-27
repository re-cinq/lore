import { describe, expect, it } from "vitest";
import type { PullRef } from "../../outbound/project/pulls/pull-requests-port.js";
import {
  doneCheckCandidates,
  doneCheckEnabled,
  doneCheckVerdict,
  mentionsIssue,
  namedPaths,
} from "./done-check.js";

const merged = (number: number, over: Partial<PullRef> = {}): PullRef => ({
  repo: "re-cinq/otto",
  number,
  title: `Change ${number}`,
  branch: `fix/${number}`,
  state: "merged",
  labels: [],
  url: `https://github.com/re-cinq/otto/pull/${number}`,
  mergedAt: `2026-10-2${number % 10}T10:00:00Z`,
  body: "",
  ...over,
});

describe("mentionsIssue", () => {
  it("finds issue 42 as #42 and as its URL, and not inside #420 or another repository's URL", () => {
    expect([
      mentionsIssue("Closes #42.", "re-cinq/otto", 42),
      mentionsIssue(
        "See https://github.com/re-cinq/otto/issues/42",
        "re-cinq/otto",
        42,
      ),
      mentionsIssue("Closes #420", "re-cinq/otto", 42),
      mentionsIssue(
        "See https://github.com/re-cinq/lore/issues/42",
        "re-cinq/otto",
        42,
      ),
    ]).toEqual([true, true, false, false]);
  });
});

describe("namedPaths", () => {
  it("takes the code files a ticket names by blob link, in backticks or bare, never specs, ADRs or markdown, at most eight", () => {
    const ticket = [
      "- [The handler](https://github.com/re-cinq/halengine/blob/b3ac62c/specs/arch/spec.md#L481)",
      "- read from `src/transport/errorMapping.ts`, the one table",
      "- see https://github.com/re-cinq/halengine/blob/b3ac62c/src/app/createApp.ts#L10",
      "- also docs/guide.md and adrs/ADR-001.md",
      "- touches lib/a.ts lib/b.ts lib/c.ts lib/d.ts lib/e.ts lib/f.ts lib/g.ts",
    ].join("\n");

    expect(namedPaths(ticket)).toEqual([
      "src/transport/errorMapping.ts",
      "src/app/createApp.ts",
      "lib/a.ts",
      "lib/b.ts",
      "lib/c.ts",
      "lib/d.ts",
      "lib/e.ts",
      "lib/f.ts",
    ]);
  });
});

describe("doneCheckCandidates", () => {
  it("ranks the merged pull requests that touched the most files the ticket names first, then the newest, adds those that name issue 42, keeps three, and never the loop's own branch for it, since 141 of 147 pull requests dod cited were merged before their ticket was filed", () => {
    const touching = [
      [
        merged(1),
        merged(3),
        merged(4, { branch: "lore/implementation-loop/issue-42" }),
      ],
      [merged(3), merged(2)],
    ];
    const naming = [
      merged(5, { body: "Closes #42" }),
      merged(6, { body: "Unrelated" }),
    ];

    expect(
      doneCheckCandidates({ touching, naming }, "re-cinq/otto", 42).map(
        (pull) => pull.number,
      ),
    ).toEqual([3, 5, 2]);
  });
});

describe("doneCheckVerdict", () => {
  const candidates = [merged(57, { title: "Add the export button" })];

  it("closes as resolved naming pull request 57 and the judge's reason when the judge says done and points at a candidate", () => {
    expect(
      doneCheckVerdict(
        { done: true, pull: 57, reason: "the button and its test are on main" },
        candidates,
      ),
    ).toBe(
      "#57 Add the export button (https://github.com/re-cinq/otto/pull/57) already does it: the button and its test are on main",
    );
  });

  it("is null when the judge says not done, names a pull request it was not shown, or gives no reason, since a closure must say what it points at and why (Otto #563 was closed citing an unrelated change)", () => {
    expect([
      doneCheckVerdict(
        { done: false, pull: 57, reason: "only half" },
        candidates,
      ),
      doneCheckVerdict({ done: true, pull: 99, reason: "done" }, candidates),
      doneCheckVerdict({ done: true, pull: 57, reason: " " }, candidates),
    ]).toEqual([null, null, null]);
  });
});

describe("doneCheckEnabled", () => {
  it("is on only when implementation_loop.done_check is true, so it stays off until its accuracy is measured", () => {
    expect([
      doneCheckEnabled({
        implementation_loop: { enabled: true, done_check: true },
      }),
      doneCheckEnabled({ implementation_loop: { enabled: true } }),
      doneCheckEnabled(null),
    ]).toEqual([true, false, false]);
  });
});
