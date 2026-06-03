import { describe, it, expect } from "vitest";
import {
  proposeLinkInsertions,
  pickStatementsForBackfill,
  type Suggestion,
} from "../spec-coverage-backfill.js";
import type { Statement, Classification } from "@re-cinq/lore-shared";

const heuristic = (testability: "testable" | "untestable", category: Classification["category"] = null): Classification => ({
  testability, category, matchedBySection: testability === "untestable",
});

const suggest = (overrides: Partial<Suggestion> = {}): Suggestion => ({
  statement_ordinal: 0,
  statement_text: "Returns the expected value.",
  test_file: "src/x.test.ts",
  test_line: 42,
  label: "validated by `x.test.ts:42`",
  ...overrides,
});

describe("proposeLinkInsertions", () => {
  it("inserts a trailing test-link parenthetical at the end of the matched statement", () => {
    const content = `## Acceptance Criteria

1. Returns the expected value.
2. Throws on null.
`;
    const out = proposeLinkInsertions(content, [suggest()]);
    expect(out.applied).toBe(1);
    expect(out.skipped).toEqual([]);
    expect(out.newContent).toContain(
      "Returns the expected value. ([validated by `x.test.ts:42`](src/x.test.ts#L42))",
    );
    expect(out.newContent).toContain("Throws on null.");
  });

  it("composes a unified-diff preview for the PR body", () => {
    const content = "## A\n\n1. Returns the expected value.\n";
    const out = proposeLinkInsertions(content, [suggest()]);
    expect(out.diffPreview).toContain("---");
    expect(out.diffPreview).toContain("+++");
    expect(out.diffPreview).toContain("-1. Returns the expected value.");
    expect(out.diffPreview).toContain("+1. Returns the expected value. ([validated by");
  });

  it("skips a statement that already carries any test link", () => {
    const content = "## A\n\n1. Returns the expected value. ([t](src/x.test.ts#L99))\n";
    const out = proposeLinkInsertions(content, [
      suggest({ statement_text: "Returns the expected value. ([t](src/x.test.ts#L99))" }),
    ]);
    expect(out.applied).toBe(0);
    expect(out.skipped).toEqual([
      { statement_ordinal: 0, reason: "already-linked" },
    ]);
    expect(out.newContent).toBe(content);
  });

  it("skips a suggestion whose statement_text is not found in the content (drift case)", () => {
    const content = "## A\n\n1. Returns the value.\n";
    const out = proposeLinkInsertions(content, [
      suggest({ statement_text: "Something completely different." }),
    ]);
    expect(out.applied).toBe(0);
    expect(out.skipped).toEqual([
      { statement_ordinal: 0, reason: "not-found" },
    ]);
  });

  it("collapses two suggestions for the same statement into one paren, comma-separated", () => {
    const content = "## A\n\n1. Survives via lease.\n";
    const out = proposeLinkInsertions(content, [
      suggest({
        statement_ordinal: 0,
        statement_text: "Survives via lease.",
        test_file: "agent/src/lease.test.ts",
        test_line: 42,
        label: "primary",
      }),
      suggest({
        statement_ordinal: 0,
        statement_text: "Survives via lease.",
        test_file: "agent/src/lease.test.ts",
        test_line: 74,
        label: "takeover",
      }),
    ]);
    expect(out.applied).toBe(2);
    expect(out.newContent).toContain(
      "Survives via lease. ([primary](agent/src/lease.test.ts#L42), [takeover](agent/src/lease.test.ts#L74))",
    );
  });

  it("omits the #Lline anchor when test_line is null", () => {
    const out = proposeLinkInsertions(
      "## A\n\n1. Returns the expected value.\n",
      [suggest({ test_line: null, label: "file-level" })],
    );
    expect(out.newContent).toContain("([file-level](src/x.test.ts))");
    expect(out.newContent).not.toContain("#L");
  });

  it("returns content unchanged when no suggestions are provided", () => {
    const content = "## A\n\n1. Plain.\n";
    const out = proposeLinkInsertions(content, []);
    expect(out.newContent).toBe(content);
    expect(out.applied).toBe(0);
    expect(out.diffPreview).toBe("");
  });
});

describe("pickStatementsForBackfill", () => {
  const stmt = (ordinal: number, text: string, kind: "sentence" | "list-item" = "list-item"): Statement => ({
    ordinal, text, kind, enclosingHeading: "Acceptance Criteria",
  });

  it("returns testable statements with no inline test link", () => {
    const statements = [
      stmt(0, "Returns the expected value."),
      stmt(1, "Throws on null."),
    ];
    const classifications = new Map<number, Classification>([
      [0, heuristic("testable")],
      [1, heuristic("testable")],
    ]);
    const out = pickStatementsForBackfill(statements, classifications);
    expect(out).toEqual([
      { ordinal: 0, text: "Returns the expected value." },
      { ordinal: 1, text: "Throws on null." },
    ]);
  });

  it("excludes statements that already carry a trailing test link", () => {
    const statements = [
      stmt(0, "Already linked. ([test](src/x.test.ts#L1))"),
      stmt(1, "Not linked yet."),
    ];
    const classifications = new Map<number, Classification>([
      [0, heuristic("testable")],
      [1, heuristic("testable")],
    ]);
    const out = pickStatementsForBackfill(statements, classifications);
    expect(out).toEqual([{ ordinal: 1, text: "Not linked yet." }]);
  });

  it("excludes statements the classifier marked untestable", () => {
    const statements = [
      stmt(0, "Narrative intro."),
      stmt(1, "Real requirement."),
    ];
    const classifications = new Map<number, Classification>([
      [0, heuristic("untestable", "intro")],
      [1, heuristic("testable")],
    ]);
    const out = pickStatementsForBackfill(statements, classifications);
    expect(out).toEqual([{ ordinal: 1, text: "Real requirement." }]);
  });

  it("returns an empty array when every testable statement is already linked", () => {
    const statements = [
      stmt(0, "Returns. ([t](src/x.test.ts#L1))"),
      stmt(1, "Throws. ([t](src/y.test.ts#L42))"),
    ];
    const classifications = new Map<number, Classification>([
      [0, heuristic("testable")],
      [1, heuristic("testable")],
    ]);
    expect(pickStatementsForBackfill(statements, classifications)).toEqual([]);
  });

  it("returns an empty array when there are no testable statements at all", () => {
    const statements = [
      stmt(0, "Narrative one."),
      stmt(1, "Narrative two."),
    ];
    const classifications = new Map<number, Classification>([
      [0, heuristic("untestable", "intro")],
      [1, heuristic("untestable", "rationale")],
    ]);
    expect(pickStatementsForBackfill(statements, classifications)).toEqual([]);
  });

  it("skips statements with no classification entry (defensive)", () => {
    const statements = [
      stmt(0, "Has no classification entry."),
      stmt(1, "Has one."),
    ];
    const classifications = new Map<number, Classification>([
      [1, heuristic("testable")],
    ]);
    expect(pickStatementsForBackfill(statements, classifications)).toEqual([
      { ordinal: 1, text: "Has one." },
    ]);
  });
});
