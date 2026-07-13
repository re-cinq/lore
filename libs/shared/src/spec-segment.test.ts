import { describe, it, expect } from "vitest";
import {
  segmentStatements,
  classifyByHeuristic,
  buildIntroOrdinals,
} from "./spec-segment.js";
import { parseTestLinksInStatement } from "./spec-link-parser.js";

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

  it("guards against splitting on abbreviations (e.g., i.e., etc.)", () => {
    const out = segmentStatements(
      "## A\n\nWe use tools like e.g. Helm and i.e. Terraform. Real boundary here.\n",
    );
    expect(out).toHaveLength(2);
    expect(out[0].text).toBe("We use tools like e.g. Helm and i.e. Terraform.");
    expect(out[1].text).toBe("Real boundary here.");
  });

  it("guards against single-letter initials in caps", () => {
    const out = segmentStatements(
      "## A\n\nThe U.S. team approved it. Next sentence.\n",
    );
    expect(out).toHaveLength(2);
    expect(out[0].text).toBe("The U.S. team approved it.");
  });

  it("does not split when the next non-space char is lowercase", () => {
    const out = segmentStatements("## A\n\nfoo. bar continues here.\n");
    expect(out).toHaveLength(1);
  });

  it("tracks the enclosing heading per statement", () => {
    const out = segmentStatements(
      [
        "# H1 Title",
        "",
        "Intro statement.",
        "",
        "## Problem Statement",
        "",
        "A problem.",
        "",
        "## Solution",
        "",
        "A solution.",
      ].join("\n"),
    );
    expect(out[0].enclosingHeading).toBe("H1 Title");
    expect(out[1].enclosingHeading).toBe("Problem Statement");
    expect(out[2].enclosingHeading).toBe("Solution");
  });

  it("produces deterministic ordinals across re-runs", () => {
    const content =
      "## A\n\n- Item one.\n- Item two.\n\nSome prose. More prose.\n";
    const first = segmentStatements(content);
    const second = segmentStatements(content);
    expect(first).toEqual(second);
    expect(first.map((s) => s.ordinal)).toEqual([0, 1, 2, 3]);
  });

  it("keeps a trailing markdown-link parenthetical attached to the sentence", () => {
    const out = segmentStatements(
      "## A\n\nA running task transitions to `cancelled` and the call returns that status. ([validated by `returns cancelled status when the task is running`](../../../mcp-server/src/features/pipeline/pipeline-crud.test.ts#L66))\n",
    );
    expect(out).toHaveLength(1);
    expect(out[0].text).toContain("([validated by");
  });

  it("keeps a validated-by link on its own line under the statement parseable as one test link", () => {
    const out = segmentStatements(
      "## A\n\nA running task transitions to `cancelled` and the call returns that status.\n([validated by `returns cancelled status when the task is running`](../../../mcp-server/src/features/pipeline/pipeline-crud.test.ts#L66))\n",
    );
    expect(out).toHaveLength(1);
    const testLinks = parseTestLinksInStatement(out[0].text);
    expect(testLinks).toHaveLength(1);
    expect(testLinks[0].path.endsWith("pipeline-crud.test.ts")).toBe(true);
    expect(testLinks[0].line).toBe(66);
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
    const intro = buildIntroOrdinals(statements);
    expect([...intro]).toEqual([0, 1]);
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
    const introSet = new Set([7]);
    const c = classifyByHeuristic(make("Anything", 7), introSet);
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

  it("classifies Vision as vision", () => {
    expect(classifyByHeuristic(make("Vision"), intro)).toMatchObject({
      category: "vision",
    });
  });

  it("classifies Clarifications as clarification", () => {
    expect(classifyByHeuristic(make("Clarifications"), intro)).toMatchObject({
      category: "clarification",
    });
  });

  it("classifies Open Questions as open-question", () => {
    expect(classifyByHeuristic(make("Open Questions"), intro)).toMatchObject({
      category: "open-question",
    });
  });

  it("classifies Limitations as limitation", () => {
    expect(
      classifyByHeuristic(make("Limitations & Open Questions"), intro),
    ).toMatchObject({
      testability: "untestable",
    });
  });

  it("classifies Rationale as rationale", () => {
    expect(classifyByHeuristic(make("Rationale"), intro)).toMatchObject({
      category: "rationale",
    });
  });

  it("returns testable + matchedBySection=false for unrecognised headings", () => {
    expect(classifyByHeuristic(make("Acceptance Criteria"), intro)).toEqual({
      testability: "testable",
      category: null,
      matchedBySection: false,
    });
  });

  // ── Content + section tightening: narrative prose that specifies no behaviour ──
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
      classifyByHeuristic(
        stmt("Decision: Deploy the Lore Agent service on GKE."),
        intro,
      ),
    ).toMatchObject({ testability: "untestable" });
    expect(
      classifyByHeuristic(
        stmt("**Decision:** Use Postgres for the knowledge graph."),
        intro,
      ),
    ).toMatchObject({ testability: "untestable" });
  });

  it("marks a bare cross-reference (See ADR-NNN) untestable", () => {
    expect(classifyByHeuristic(stmt("See ADR-015."), intro)).toMatchObject({
      testability: "untestable",
    });
    expect(
      classifyByHeuristic(
        stmt("See the dark-factory spec for details."),
        intro,
      ),
    ).toMatchObject({ testability: "untestable" });
  });

  it("classifies narrative doc sections (alternatives/research/personas/consequences/out-of-scope/phases) as untestable", () => {
    for (const h of [
      "Alternatives Considered",
      "Research",
      "User Personas",
      "Consequences",
      "Out of Scope",
      "Implementation Phases",
    ]) {
      expect(classifyByHeuristic(stmt("anything", h), intro)).toMatchObject({
        testability: "untestable",
      });
    }
  });

  it("leaves a real functional requirement testable (does not over-classify)", () => {
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
