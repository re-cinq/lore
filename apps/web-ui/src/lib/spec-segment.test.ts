import { describe, it, expect } from "vitest";
import {
  segmentStatements,
  classifyByHeuristic,
  buildIntroOrdinals,
} from "./spec-segment";

describe("segmentStatements", () => {
  it("splits prose paragraphs into sentences", () => {
    const out = segmentStatements(
      "## A\n\nFirst sentence. Second sentence! Third?\n",
    );

    expect(out.map((s) => s.text)).toEqual([
      "First sentence.",
      "Second sentence!",
      "Third?",
    ]);
    expect(out.every((s) => s.kind === "sentence")).toBe(true);
    expect(out.every((s) => s.enclosingHeading === "A")).toBe(true);
  });

  it("treats each list item as its own statement", () => {
    const out = segmentStatements(
      "## A\n\n- First item.\n- Second item.\n- Third item.\n",
    );

    expect(out.map((s) => s.text)).toEqual([
      "First item.",
      "Second item.",
      "Third item.",
    ]);
    expect(out.every((s) => s.kind === "list-item")).toBe(true);
  });

  it("joins multi-line list-item continuations into one statement", () => {
    const out = segmentStatements(
      "## A\n\n- First item that\n  wraps to a second line.\n- Second item.\n",
    );

    expect(out[0].text).toBe("First item that wraps to a second line.");
    expect(out).toHaveLength(2);
  });

  it("ends a list-item continuation at a heading, table row, or code fence", () => {
    const out = segmentStatements(
      [
        "## A",
        "",
        "- Item before heading.",
        "## B",
        "- Item before table.",
        "| a | b |",
        "- Item before fence.",
        "```ts",
        "const x = 1;",
        "```",
      ].join("\n"),
    );

    expect(out.map((s) => s.text)).toEqual([
      "Item before heading.",
      "Item before table.",
      "Item before fence.",
    ]);
  });

  it("drops a bare list marker with no text", () => {
    expect(segmentStatements("## A\n\n- \n")).toEqual([]);
  });

  it("keeps single-initial abbreviations like J. B. in one sentence", () => {
    const out = segmentStatements(
      "## A\n\nWritten by J. B. Rainsberger. Second sentence here.\n",
    );

    expect(out.map((s) => s.text)).toEqual([
      "Written by J. B. Rainsberger.",
      "Second sentence here.",
    ]);
  });

  it("splits after punctuation-only leading sentences", () => {
    const out = segmentStatements("## A\n\n... Then the prose starts.\n");

    expect(out.map((s) => s.text)).toEqual(["...", "Then the prose starts."]);
  });

  it("excludes headings, fenced code, and tables", () => {
    const out = segmentStatements(
      [
        "# Title",
        "",
        "Intro sentence.",
        "",
        "## Section",
        "",
        "```ts",
        "const x = 1;",
        "```",
        "",
        "Real prose.",
        "",
        "| a | b |",
        "| - | - |",
        "| 1 | 2 |",
        "",
        "More prose.",
        "",
      ].join("\n"),
    );

    expect(out.map((s) => s.text)).toEqual([
      "Intro sentence.",
      "Real prose.",
      "More prose.",
    ]);
  });

  it("guards against splitting on abbreviations", () => {
    const out = segmentStatements(
      "## A\n\nWe use tools like e.g. Helm and i.e. Terraform. Real boundary here.\n",
    );

    expect(out).toHaveLength(2);
    expect(out[1].text).toBe("Real boundary here.");
  });

  it("does not split when the next non-space char is lowercase", () => {
    expect(
      segmentStatements("## A\n\nfoo. bar continues here.\n"),
    ).toHaveLength(1);
  });

  it("produces deterministic ordinals across re-runs", () => {
    const content =
      "## A\n\n- Item one.\n- Item two.\n\nSome prose. More prose.\n";
    const first = segmentStatements(content);

    expect(first).toEqual(segmentStatements(content));
    expect(first.map((s) => s.ordinal)).toEqual([0, 1, 2, 3]);
  });

  it("returns an empty array for content with no statements", () => {
    expect(segmentStatements("# Only a title\n")).toEqual([]);
    expect(segmentStatements("")).toEqual([]);
  });
});

describe("buildIntroOrdinals", () => {
  it("marks statements under the document's first heading as intro", () => {
    const statements = segmentStatements(
      [
        "# Feature Specification: X",
        "",
        "An introduction.",
        "",
        "## Solution",
        "",
        "A solution.",
      ].join("\n"),
    );
    const intro = buildIntroOrdinals(statements);

    expect(intro.has(statements[0].ordinal)).toBe(true);
    expect(intro.has(statements[1].ordinal)).toBe(false);
  });

  it("treats statements with no enclosing heading as intro", () => {
    const statements = segmentStatements(
      "Leading prose with no heading at all. Another one.\n",
    );

    expect([...buildIntroOrdinals(statements)]).toEqual([0, 1]);
  });
});

describe("classifyByHeuristic", () => {
  const intro = new Set<number>();
  const make = (heading: string | null, ordinal = 99) => ({
    ordinal,
    text: "x",
    kind: "sentence" as const,
    enclosingHeading: heading,
  });

  it("marks intro-ordinal statements untestable as 'intro'", () => {
    const c = classifyByHeuristic(make("Anything", 7), new Set([7]));

    expect(c).toEqual({
      testability: "untestable",
      category: "intro",
      matchedBySection: true,
    });
  });

  it("classifies Problem Statement as background", () => {
    expect(classifyByHeuristic(make("Problem Statement"), intro)).toMatchObject(
      {
        testability: "untestable",
        category: "background",
      },
    );
  });

  it("returns testable for unrecognised headings", () => {
    expect(classifyByHeuristic(make("Acceptance Criteria"), intro)).toEqual({
      testability: "testable",
      category: null,
      matchedBySection: false,
    });
  });

  it("returns testable for a statement with no enclosing heading", () => {
    expect(classifyByHeuristic(make(null), intro)).toEqual({
      testability: "testable",
      category: null,
      matchedBySection: false,
    });
  });

  const stmt = (
    text: string,
    heading: string | null = "Functional Requirements",
  ) => ({
    ordinal: 99,
    text,
    kind: "sentence" as const,
    enclosingHeading: heading,
  });

  it("marks a Decision:-prefixed statement untestable regardless of section", () => {
    expect(
      classifyByHeuristic(stmt("Decision: Deploy on GKE."), intro),
    ).toMatchObject({ testability: "untestable" });
    expect(
      classifyByHeuristic(stmt("**Decision:** Use Postgres."), intro),
    ).toMatchObject({ testability: "untestable" });
  });

  it("marks a bare cross-reference (See ADR-NNN) untestable", () => {
    expect(classifyByHeuristic(stmt("See ADR-015."), intro)).toMatchObject({
      testability: "untestable",
    });
  });

  it("classifies narrative doc sections (alternatives/research/personas/out-of-scope) as untestable", () => {
    for (const h of [
      "Alternatives Considered",
      "Research",
      "User Personas",
      "Out of Scope",
    ]) {
      expect(classifyByHeuristic(stmt("anything", h), intro)).toMatchObject({
        testability: "untestable",
      });
    }
  });

  it("leaves a real functional requirement testable", () => {
    expect(
      classifyByHeuristic(
        stmt("FR-8.3: Gap signal feeds the autoresearch loop."),
        intro,
      ),
    ).toEqual({
      testability: "testable",
      category: null,
      matchedBySection: false,
    });
  });
});
