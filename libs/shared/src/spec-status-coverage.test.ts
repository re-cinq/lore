import { describe, it, expect } from "vitest";
import {
  coverageStatusLabel,
  coverageTier,
  expectedStatus,
  statementCoverage,
  statusLabel,
  unlinkedTestableStatements,
} from "./spec-status-coverage.js";

const LINK = "([validated by](payments.test.ts#L10))";

// Intro prose under the H1 anchors `buildIntroOrdinals` to the H1, so the two
// requirement sentences land on lines 11 and 13 as testable statements.
const spec = (status: string) =>
  [
    "# My Feature", // 1
    "", // 2
    "Intro paragraph describing the feature.", // 3
    "", // 4
    "| Field | Value |", // 5
    "|---|---|", // 6
    `| Status | ${status} |`, // 7
    "", // 8
    "## Functional Requirements", // 9
    "", // 10
    "The system returns a receipt for every payment.", // 11
    "", // 12
    "The system emails the receipt to the payer.", // 13
  ].join("\n");

const linkFirst = (content: string) =>
  content.replace("for every payment.", `for every payment. ${LINK}`);
const linkSecond = (content: string) =>
  content.replace("to the payer.", `to the payer. ${LINK}`);

// Every non-intro statement sits under a narrative heading — nothing testable.
const narrativeOnly = [
  "# My Feature",
  "",
  "Intro paragraph describing the feature.",
  "",
  "| Field | Value |",
  "|---|---|",
  "| Status | Shipped |",
  "",
  "## Rationale",
  "",
  "We chose receipts because auditors require them.",
].join("\n");

describe("statementCoverage", () => {
  it("counts 2 testable and 0 linked when no statement carries a link", () => {
    expect(statementCoverage(spec("Draft"))).toEqual({
      testable: 2,
      linked: 0,
      unlinked: [
        { text: "The system returns a receipt for every payment.", line: 11 },
        { text: "The system emails the receipt to the payer.", line: 13 },
      ],
    });
  });

  it("counts 2 testable and 1 linked when one statement carries a link", () => {
    expect(statementCoverage(linkFirst(spec("Draft")))).toEqual({
      testable: 2,
      linked: 1,
      unlinked: [
        { text: "The system emails the receipt to the payer.", line: 13 },
      ],
    });
  });

  it("counts 2 testable and 2 linked when every statement carries a link", () => {
    expect(statementCoverage(linkSecond(linkFirst(spec("Draft"))))).toEqual({
      testable: 2,
      linked: 2,
      unlinked: [],
    });
  });

  it("counts 0 testable when every statement is intro or narrative", () => {
    expect(statementCoverage(narrativeOnly)).toEqual({
      testable: 0,
      linked: 0,
      unlinked: [],
    });
  });
});

describe("unlinkedTestableStatements", () => {
  it("returns the unlinked statements with their lines", () => {
    expect(unlinkedTestableStatements(linkFirst(spec("Draft")))).toEqual([
      { text: "The system emails the receipt to the payer.", line: 13 },
    ]);
  });

  it("returns empty when every statement is linked", () => {
    expect(
      unlinkedTestableStatements(linkSecond(linkFirst(spec("Draft")))),
    ).toEqual([]);
  });
});

describe("coverageTier", () => {
  it("returns vacuous when no statement is testable", () => {
    expect(coverageTier(0, 0)).toBe("vacuous");
  });

  it("returns none when no testable statement is linked", () => {
    expect(coverageTier(3, 0)).toBe("none");
  });

  it("returns partial when some testable statements are linked", () => {
    expect(coverageTier(3, 1)).toBe("partial");
  });

  it("returns full when every testable statement is linked", () => {
    expect(coverageTier(3, 3)).toBe("full");
  });
});

describe("expectedStatus", () => {
  it("maps none to draft, partial to in-progress, full to shipped", () => {
    expect(expectedStatus("none")).toBe("draft");
    expect(expectedStatus("partial")).toBe("in-progress");
    expect(expectedStatus("full")).toBe("shipped");
  });

  it("maps vacuous to null", () => {
    expect(expectedStatus("vacuous")).toBeNull();
  });
});

describe("statusLabel", () => {
  it("renders spec statuses in the corpus's Title Case", () => {
    expect(statusLabel("draft", "spec")).toBe("Draft");
    expect(statusLabel("in-progress", "spec")).toBe("In Progress");
    expect(statusLabel("shipped", "spec")).toBe("Shipped");
  });

  it("renders ADR frontmatter statuses in lowercase", () => {
    expect(statusLabel("draft", "adr")).toBe("draft");
    expect(statusLabel("in-progress", "adr")).toBe("in progress");
    expect(statusLabel("shipped", "adr")).toBe("shipped");
  });

  it("throws for a terminal status that no tier derives", () => {
    expect(() => statusLabel("retired", "spec")).toThrow(
      new Error('no spec label for status "retired"'),
    );
  });
});

describe("coverageStatusLabel", () => {
  it("returns Draft for a spec with no linked statements", () => {
    expect(coverageStatusLabel(spec("Shipped"), "spec")).toBe("Draft");
  });

  it("returns In Progress for a spec with one of two statements linked", () => {
    expect(coverageStatusLabel(linkFirst(spec("Draft")), "spec")).toBe(
      "In Progress",
    );
  });

  it("returns Shipped for a spec with every statement linked", () => {
    expect(
      coverageStatusLabel(linkSecond(linkFirst(spec("Draft"))), "spec"),
    ).toBe("Shipped");
  });

  it("returns null for a doc with no testable statements", () => {
    expect(coverageStatusLabel(narrativeOnly, "spec")).toBeNull();
  });
});
