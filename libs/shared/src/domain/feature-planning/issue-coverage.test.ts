import { describe, expect, it } from "vitest";
import {
  coverageSections,
  issueCoverage,
  issueCoverageBrief,
  partAt,
  partsNamed,
  specFileOf,
  specParts,
  statementLink,
  storyCoverageOf,
} from "./issue-coverage.js";
import type { SpecLine } from "./decomposition-result.js";

const SPEC = [
  "# Feature",
  "",
  "Members pay in their own currency.",
  "",
  "## Requirements",
  "",
  "- FR1 — The station files one issue per task. ([from plan](https://lore.example/plans/p1#b-1), [validated by files one](libs/a.test.ts#L4))",
  "- FR2 — The station links each issue",
  "  to the story.",
  "- FR3 — The story lists every task.",
  "",
  "## Behaviour",
  "",
  "The run settles once. It never files twice.",
  "",
  "## Rationale",
  "",
  "People forget requirements.",
  "",
].join("\n");

describe("specParts", () => {
  it("lists the testable statements by the line they start on, a paragraph's sentences as one part, without their link group", () => {
    expect(specParts(SPEC)).toEqual([
      { line: 7, text: "FR1 — The station files one issue per task." },
      { line: 8, text: "FR2 — The station links each issue to the story." },
      { line: 10, text: "FR3 — The story lists every task." },
      { line: 14, text: "The run settles once. It never files twice." },
    ]);
  });

  it("keeps only FR1 for plan p1, the one statement citing it", () => {
    expect(specParts(SPEC, "p1")).toEqual([
      { line: 7, text: "FR1 — The station files one issue per task." },
    ]);
  });

  it("keeps none for plan p9 when FR1 cites plan p1 and none cites p9", () => {
    expect(specParts(SPEC, "p9")).toEqual([]);
  });

  it("keeps all 4 statements for plan p9 when no statement cites any plan", () => {
    expect(
      specParts(
        SPEC.replace("[from plan](https://lore.example/plans/p1#b-1), ", ""),
        "p9",
      ),
    ).toHaveLength(4);
  });
});

describe("partAt", () => {
  const parts = specParts(SPEC);

  it("finds the list item starting at line 8 for line 9 inside it", () => {
    expect(partAt(parts, 9)?.line).toBe(8);
  });

  it("finds nothing for line 3, before the first testable statement", () => {
    expect(partAt(parts, 3)).toBeUndefined();
  });
});

describe("partsNamed", () => {
  it("names FR1 and FR2 once each, in spec order, for lines 9, 7 and 8", () => {
    expect(
      partsNamed(specParts(SPEC), [9, 7, 8]).map(({ line }) => line),
    ).toEqual([7, 8]);
  });
});

const lines = (...numbers: number[]) => numbers.map((line) => ({ line }));

const OTHER = [
  "# Other",
  "",
  "Reviewers read the run.",
  "",
  "## Requirements",
  "",
  "- FR9 — The other spec counts too.",
  "",
].join("\n");

describe("issueCoverage", () => {
  it("reports 2 of 4 covered with FR3 and the paragraph missing, a line inside FR2 counting for it", () => {
    const tasks = [{ spec_lines: lines(7) }, { spec_lines: lines(9, 3) }, {}];

    expect(
      issueCoverage(
        [{ file: "specs/f/spec.md", parts: specParts(SPEC) }],
        tasks,
      ),
    ).toEqual({
      total: 4,
      covered: 2,
      missing: [
        { line: 10, text: "FR3 — The story lists every task." },
        { line: 14, text: "The run settles once. It never files twice." },
      ],
    });
  });

  it("reports 4 of 5 covered across two specs with FR9 of specs/o/spec.md missing, line 7 of the main spec not counting for it", () => {
    const specs = [
      { file: "specs/f/spec.md", parts: specParts(SPEC) },
      { file: "specs/o/spec.md", parts: specParts(OTHER) },
    ];
    const tasks = [
      { spec_lines: [...lines(8, 14), { file: "specs/f/spec.md", line: 10 }] },
      { spec_lines: lines(7) },
    ];

    expect(issueCoverage(specs, tasks)).toEqual({
      total: 5,
      covered: 4,
      missing: [
        {
          file: "specs/o/spec.md",
          line: 7,
          text: "FR9 — The other spec counts too.",
        },
      ],
    });
  });
});

describe("issueCoverageBrief", () => {
  const link = ({ file = "specs/f/spec.md", line }: SpecLine) =>
    statementLink({ repo: "o/r", file, ref: "main", line });

  it("names each statement no task covers with its line and link", () => {
    const coverage = issueCoverage(
      [{ file: "specs/f/spec.md", parts: specParts(SPEC) }],
      [{ spec_lines: lines(7, 8, 14) }],
    );

    expect(issueCoverageBrief(coverage, link)).toBe(
      [
        "## Spec coverage",
        "",
        "3 of 4 testable spec statements have a task. Not covered yet:",
        "",
        "- line 10: FR3 — The story lists every task. — https://github.com/o/r/blob/main/specs/f/spec.md#L10",
        "",
      ].join("\n"),
    );
  });

  it("names FR9 by its spec specs/o/spec.md as well as its line 5", () => {
    const coverage = {
      total: 1,
      covered: 0,
      missing: [{ file: "specs/o/spec.md", line: 5, text: "FR9." }],
    };

    expect(issueCoverageBrief(coverage, link)).toContain(
      "- specs/o/spec.md line 5: FR9. — https://github.com/o/r/blob/main/specs/o/spec.md#L5",
    );
  });

  it("says every statement has a task when none is missing", () => {
    expect(
      issueCoverageBrief({ total: 4, covered: 4, missing: [] }, link),
    ).toBe(
      "## Spec coverage\n\n4 of 4 testable spec statements have a task.\n",
    );
  });
});

describe("statementLink", () => {
  it("links the line at the commit the decomposition read", () => {
    expect(
      statementLink({
        repo: "o/r",
        file: "specs/f/spec.md",
        ref: "abc123",
        line: 42,
      }),
    ).toBe("https://github.com/o/r/blob/abc123/specs/f/spec.md#L42");
  });
});

describe("specFileOf", () => {
  it("reads the spec.md of the spec-kit directory specs/checkout/", () => {
    expect(specFileOf("specs/checkout/")).toBe("specs/checkout/spec.md");
  });

  it("reads specs/checkout/spec.md as it is named", () => {
    expect(specFileOf("specs/checkout/spec.md")).toBe("specs/checkout/spec.md");
  });
});

const OTTO_ENTRIES = Array.from(
  { length: 240 },
  (_, index) =>
    `- line ${index + 1}: ${"The agent answers the ticket. ".repeat(10)}— https://github.com/re-cinq/otto/blob/b4a46cb6/specs/tms/spec.md#L${index + 1}`,
);
const OTTO_COVERAGE = [
  "## Spec coverage",
  "",
  "28 of 268 testable spec statements have a task. Not covered yet:",
  "",
  ...OTTO_ENTRIES,
  "",
].join("\n");

describe("coverageSections", () => {
  it("keeps 240 entries of 300 chars under 65,536 in the body and every comment, and reads all 240 back", () => {
    const { body, comments } = coverageSections(OTTO_COVERAGE, "p1");

    expect({
      longest:
        Math.max(body.length, ...comments.map((c) => c.length)) <= 65_536,
      entries: storyCoverageOf(body, comments, "p1"),
    }).toEqual({ longest: true, entries: OTTO_ENTRIES });
  });
});

describe("storyCoverageOf", () => {
  it("reads the entry for line 5 of specs/o/spec.md beside the main spec's line 7", () => {
    const body = [
      "## Spec coverage",
      "",
      "- line 7: FR1. — https://x/L7",
      "- specs/o/spec.md line 5: FR9. — https://x/L5",
      "",
    ].join("\n");

    expect(storyCoverageOf(body, [], "p1")).toEqual([
      "- line 7: FR1. — https://x/L7",
      "- specs/o/spec.md line 5: FR9. — https://x/L5",
    ]);
  });
});
