import { describe, it, expect } from "vitest";
import {
  resolveTestLink,
  collectBrokenLinks,
  formatBrokenLinksReport,
  type ChunkLineRange,
  type BrokenLink,
} from "./spec-coverage-validate.js";
import type { TestLinkRef } from "@re-cinq/lore-shared";

const ref = (path: string, line: number | null = null): TestLinkRef => ({
  label: "t", path, line,
});

const chunk = (file_path: string, start_line: number | null, end_line: number | null): ChunkLineRange => ({
  file_path, start_line, end_line,
});

describe("resolveTestLink (pure)", () => {
  it("passes when the linked file has a chunk covering the linked line", () => {
    const out = resolveTestLink(ref("src/x.test.ts", 42), [
      chunk("src/x.test.ts", 30, 50),
    ]);
    expect(out).toEqual({ ok: true });
  });

  it("flags file-missing when no chunk has the linked file path", () => {
    const out = resolveTestLink(ref("src/missing.test.ts", 10), [
      chunk("src/x.test.ts", 1, 100),
    ]);
    expect(out).toEqual({ ok: false, reason: "file-missing" });
  });

  it("flags line-out-of-range when the file exists but no chunk covers the line", () => {
    const out = resolveTestLink(ref("src/x.test.ts", 200), [
      chunk("src/x.test.ts", 30, 50),
      chunk("src/x.test.ts", 60, 90),
    ]);
    expect(out).toEqual({ ok: false, reason: "line-out-of-range" });
  });

  it("passes with a null line when the file path exists at all (file-level link)", () => {
    const out = resolveTestLink(ref("src/x.test.ts", null), [
      chunk("src/x.test.ts", 1, 50),
    ]);
    expect(out).toEqual({ ok: true });
  });

  it("flags file-missing for a null-line link to an unknown file", () => {
    const out = resolveTestLink(ref("src/missing.test.ts", null), [
      chunk("src/x.test.ts", 1, 50),
    ]);
    expect(out).toEqual({ ok: false, reason: "file-missing" });
  });

  it("passes when ANY of multiple chunks for the file covers the line", () => {
    const out = resolveTestLink(ref("src/x.test.ts", 75), [
      chunk("src/x.test.ts", 1, 50),
      chunk("src/x.test.ts", 60, 100),
    ]);
    expect(out).toEqual({ ok: true });
  });
});

describe("collectBrokenLinks", () => {
  const md = `## Acceptance Criteria

1. Returns. ([t](src/x.test.ts#L42))
2. Throws. ([t](src/missing.test.ts#L10))
3. Logs. ([t](src/y.test.ts#L5000))
`;
  const chunks: ChunkLineRange[] = [
    chunk("src/x.test.ts", 30, 50),
    chunk("src/y.test.ts", 1, 100),
  ];

  it("returns one broken-link entry per failed resolve, with reason", () => {
    const out = collectBrokenLinks("specs/x/spec.md", md, chunks);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      spec_path: "specs/x/spec.md",
      reason: "file-missing",
      link: { path: "src/missing.test.ts", line: 10 },
    });
    expect(out[1]).toMatchObject({
      spec_path: "specs/x/spec.md",
      reason: "line-out-of-range",
      link: { path: "src/y.test.ts", line: 5000 },
    });
  });

  it("returns empty when every link resolves", () => {
    expect(collectBrokenLinks("x", "## A\n\nLinked. ([t](src/x.test.ts#L42))", chunks)).toEqual([]);
  });

  it("returns empty when the spec has no test links at all", () => {
    expect(collectBrokenLinks("x", "## A\n\nPlain prose.\n", chunks)).toEqual([]);
  });
});

describe("formatBrokenLinksReport", () => {
  it("renders a human-readable PR-comment / issue body with grouping by spec", () => {
    const broken: BrokenLink[] = [
      {
        spec_path: "specs/a/spec.md",
        statement_text: "Returns the expected value.",
        link: { label: "test", path: "src/missing.test.ts", line: 10 },
        reason: "file-missing",
      },
      {
        spec_path: "specs/a/spec.md",
        statement_text: "Throws on null.",
        link: { label: "test", path: "src/x.test.ts", line: 5000 },
        reason: "line-out-of-range",
      },
      {
        spec_path: "specs/b/spec.md",
        statement_text: "Logs a warning.",
        link: { label: "test", path: "src/y.test.ts", line: 99 },
        reason: "line-out-of-range",
      },
    ];
    const body = formatBrokenLinksReport(broken);
    expect(body).toContain("specs/a/spec.md");
    expect(body).toContain("specs/b/spec.md");
    expect(body).toContain("file-missing");
    expect(body).toContain("line-out-of-range");
    expect(body).toContain("src/missing.test.ts:10");
    expect(body).toContain("src/y.test.ts:99");
  });

  it("returns the empty string when there are no broken links", () => {
    expect(formatBrokenLinksReport([])).toBe("");
  });
});
