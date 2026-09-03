import { describe, it, expect } from "vitest";
import {
  escapeXmlAttr,
  dedupeItems,
  serializeDocument,
  serializeContext,
  type SourceItem,
} from "./context-assembly-format.js";

const source = (over: Partial<SourceItem> = {}): SourceItem => ({
  text: "body",
  tokens: 1,
  ...over,
});

describe("escapeXmlAttr", () => {
  it("escapes quotes, ampersands, and angle brackets", () => {
    expect(escapeXmlAttr('a"b&c<d>e')).toBe("a&quot;b&amp;c&lt;d&gt;e");
  });
});

describe("dedupeItems", () => {
  it("keeps one source per source_path, retaining the higher score", () => {
    const sources = [
      source({ source_path: "adrs/A.md", score: 0.2 }),
      source({ source_path: "adrs/A.md", score: 0.9 }),
      source({ source_path: "adrs/B.md", score: 0.5 }),
    ];
    const result = dedupeItems(sources);

    expect(result).toHaveLength(2);
    expect(result.find((i) => i.source_path === "adrs/A.md")?.score).toBe(0.9);
  });

  it("keeps items without a source_path untouched", () => {
    const sources = [source({ text: "x" }), source({ text: "y" })];

    expect(dedupeItems(sources)).toHaveLength(2);
  });
});

describe("serializeDocument", () => {
  it("renders provenance as attributes and contains markdown without heading collision", () => {
    const out = serializeDocument(
      source({
        text: "## Consequences\n\nbody",
        source_path: "adrs/ADR-016-dark-factory.md",
        content_type: "adr",
        score: 0.83,
        tokens: 640,
      }),
    );

    expect(out).toBe(
      '<document source="adrs/ADR-016-dark-factory.md" type="adr" relevance="0.83" tokens="640">\n## Consequences\n\nbody\n</document>',
    );
  });

  it("marks a truncated document with a truncated attribute", () => {
    const out = serializeDocument(source({ source_path: "x.md", tokens: 5 }), {
      truncated: true,
    });

    expect(out).toContain('truncated="true"');
  });
});

describe("serializeContext", () => {
  it("wraps sections and documents in nested context/section/document tags", () => {
    const out = serializeContext(
      { query: "add auth", template: "implementation", budget: 8000 },
      [
        {
          header: "Architecture Decisions",
          source: "adrs",
          priority: 1,
          truncated: false,
          items: [
            source({
              source_path: "adrs/ADR-016.md",
              content_type: "adr",
              tokens: 3,
            }),
          ],
        },
      ],
    );

    expect(out).toContain(
      '<context query="add auth" template="implementation" budget="8000">',
    );
    expect(out).toContain(
      '<section name="Architecture Decisions" source="adrs" priority="1">',
    );
    expect(out).toContain(
      '<document source="adrs/ADR-016.md" type="adr" tokens="3">',
    );
    expect(out.trim().endsWith("</context>")).toBe(true);
  });
});
