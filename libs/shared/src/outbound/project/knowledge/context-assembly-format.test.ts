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

  it("merges the three chunks of adrs/A.md into one document, the best-scoring chunk first", () => {
    const merged = dedupeItems([
      source({
        source_path: "adrs/A.md",
        text: "## Context",
        tokens: 5,
        score: 0.6,
        similarity: 0.7,
      }),
      source({
        source_path: "adrs/A.md",
        text: "## Decision",
        tokens: 7,
        score: 0.9,
        similarity: 0.8,
      }),
      source({
        source_path: "adrs/A.md",
        text: "## Consequences",
        tokens: 4,
        score: 0.3,
      }),
    ]);

    expect(merged).toEqual([
      {
        source_path: "adrs/A.md",
        text: "## Decision\n\n## Context\n\n## Consequences",
        tokens: 16,
        score: 0.9,
        similarity: 0.8,
      },
    ]);
  });

  it("keeps the best three chunks of a document and leaves the fourth out", () => {
    const [merged] = dedupeItems(
      [0.9, 0.8, 0.7, 0.6].map((score) =>
        source({
          source_path: "specs/a/spec.md",
          text: `chunk ${score}`,
          score,
        }),
      ),
    );

    expect(merged.text).toBe("chunk 0.9\n\nchunk 0.8\n\nchunk 0.7");
  });

  it("places a merged document where its best chunk ranked", () => {
    const ranked = dedupeItems([
      source({ source_path: "adrs/A.md", text: "A context", score: 0.9 }),
      source({ source_path: "adrs/B.md", text: "B", score: 0.8 }),
      source({ source_path: "adrs/A.md", text: "A decision", score: 0.7 }),
    ]);

    expect(ranked.map((it) => it.source_path)).toEqual([
      "adrs/A.md",
      "adrs/B.md",
    ]);
  });

  it("collapses trace-impact-workflow.ts and its twin sharing content_hash abc123 to one item", () => {
    const twin = { text: "same body", tokens: 3, content_hash: "abc123" };
    const deduped = dedupeItems([
      {
        ...twin,
        source_path: "apps/web-ui/src/lib/trace-impact-workflow.ts",
        score: 0.85,
      },
      {
        ...twin,
        source_path: "libs/shared/src/work/trace-impact-workflow.ts",
        score: 0.85,
      },
      {
        text: "other",
        tokens: 1,
        source_path: "other.ts",
        content_hash: "def456",
      },
    ]);

    expect(deduped.map((i) => i.source_path)).toEqual([
      "apps/web-ui/src/lib/trace-impact-workflow.ts",
      "other.ts",
    ]);
  });

  it("keeps items without a source_path untouched", () => {
    const sources = [source({ text: "x" }), source({ text: "y" })];

    expect(dedupeItems(sources)).toHaveLength(2);
  });

  it("keeps a path-less item at rank 2 between two keyed survivors instead of moving it last", () => {
    const keyed = (path: string, score: number) => ({
      text: path,
      tokens: 1,
      source_path: path,
      score,
    });
    const ranked = [
      keyed("a.ts", 0.9),
      { text: "memory", tokens: 1, score: 0.8 },
      keyed("b.ts", 0.7),
      keyed("a.ts", 0.1),
    ];

    expect(dedupeItems(ranked).map((it) => it.source_path ?? it.text)).toEqual([
      "a.ts",
      "memory",
      "b.ts",
    ]);
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
          documents: [
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
