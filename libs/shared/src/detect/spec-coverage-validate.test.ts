import { describe, it, expect } from "vitest";
import {
  resolveTestLink,
  collectBrokenLinks,
  formatBrokenLinksReport,
  hasOpenLinkRotIssue,
  type ChunkLineRange,
  type BrokenLink,
} from "./spec-coverage-validate.js";
import type { TestLinkRef } from "../index.js";

const ref = (path: string, line: number | null = null): TestLinkRef => ({
  label: "t",
  path,
  line,
});

const chunk = (
  file_path: string,
  start_line: number | null,
  end_line: number | null,
): ChunkLineRange => ({
  file_path,
  start_line,
  end_line,
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
    expect(
      collectBrokenLinks(
        "x",
        "## A\n\nLinked. ([t](src/x.test.ts#L42))",
        chunks,
      ),
    ).toEqual([]);
  });

  it("returns empty when the spec has no test links at all", () => {
    expect(collectBrokenLinks("x", "## A\n\nPlain prose.\n", chunks)).toEqual(
      [],
    );
  });

  it("flags a coverage link placed outside the trailing parenthetical", () => {
    const md = "## A\n\n- Returns ([t](src/x.test.ts#L42)) the value\n";
    const out = collectBrokenLinks("specs/x/spec.md", md, chunks);

    expect(out).toEqual([
      {
        spec_path: "specs/x/spec.md",
        statement_text: "Returns ([t](src/x.test.ts#L42)) the value",
        link: { label: "t", path: "src/x.test.ts", line: 42 },
        reason: "non-trailing-link",
      },
    ]);
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

  it("keeps a report over GitHub's 65536-char issue limit under budget, ending with a truncation line and the footer", () => {
    const broken: BrokenLink[] = Array.from({ length: 2000 }, (_, i) => ({
      spec_path: `specs/spec-${i % 40}/spec.md`,
      statement_text: `Statement ${i}: ${"x".repeat(70)}`,
      link: {
        label: "test",
        path: `src/deep/nested/path/file-${i}.test.ts`,
        line: i + 1,
      },
      reason: "line-out-of-range" as const,
    }));
    const body = formatBrokenLinksReport(broken);

    expect(body.length).toBeLessThan(65536);
    expect(body).toContain("2000 links across 40 specs");
    expect(body).toMatch(
      /…and \d+ more broken link\(s\) truncated — see the job logs\./,
    );
    expect(
      body
        .trimEnd()
        .endsWith("Fix or remove the broken links to silence this."),
    ).toBe(true);
    // never cuts mid-bullet: every rendered bullet line is complete

    for (const line of body.split("\n")) {
      if (line.startsWith("- **")) {
        expect(line).toMatch(/— referenced by: _.*_$/);
      }
    }
  });

  it("leaves a small report byte-identical to the uncapped rendering", () => {
    const broken: BrokenLink[] = [
      {
        spec_path: "specs/a/spec.md",
        statement_text: "Returns the expected value.",
        link: { label: "test", path: "src/missing.test.ts", line: 10 },
        reason: "file-missing",
      },
    ];
    const body = formatBrokenLinksReport(broken);

    expect(body).not.toContain("truncated");
    expect(
      body
        .trimEnd()
        .endsWith("Fix or remove the broken links to silence this."),
    ).toBe(true);
  });
});

describe("hasOpenLinkRotIssue", () => {
  it("returns true when an open issue carries the spec-link-rot label", () => {
    expect(
      hasOpenLinkRotIssue([{ labels: ["lore-managed", "spec-link-rot"] }]),
    ).toBe(true);
  });

  it("returns false when no open issue carries the label", () => {
    expect(
      hasOpenLinkRotIssue([{ labels: ["lore-managed"] }, { labels: [] }]),
    ).toBe(false);
  });

  it("returns false for an empty issue list", () => {
    expect(hasOpenLinkRotIssue([])).toBe(false);
  });
});

describe("resolveTestLink with range-less chunks", () => {
  it("passes a line link when the file's chunks carry no line ranges", () => {
    const out = resolveTestLink(ref("src/x.test.ts", 42), [
      chunk("src/x.test.ts", null, null),
    ]);

    expect(out).toEqual({ ok: true });
  });

  it("judges against the ranged chunks when ranged and range-less coexist", () => {
    const out = resolveTestLink(ref("src/x.test.ts", 200), [
      chunk("src/x.test.ts", null, null),
      chunk("src/x.test.ts", 30, 50),
    ]);

    expect(out).toEqual({ ok: false, reason: "line-out-of-range" });
  });
});

describe("formatBrokenLinksReport heading elision", () => {
  it("skips a spec heading whose bullets were all elided by the budget", () => {
    const broken: BrokenLink[] = [
      {
        spec_path: "specs/a/spec.md",
        statement_text: "Returns the expected value.",
        link: { label: "test", path: "src/x.test.ts", line: 10 },
        reason: "line-out-of-range",
      },
      {
        spec_path: "specs/huge/spec.md",
        statement_text: "Oversized.",
        link: {
          label: "test",
          path: `src/${"x".repeat(70_000)}.test.ts`,
          line: 1,
        },
        reason: "file-missing",
      },
    ];
    const body = formatBrokenLinksReport(broken);

    expect(body).toContain("### `specs/a/spec.md`");
    expect(body).not.toContain("specs/huge/spec.md");
    expect(body).toMatch(/…and 1 more broken link\(s\) truncated/);
  });
});

describe("collectBrokenLinks non-trailing false positives", () => {
  const chunks: ChunkLineRange[] = [chunk("src/x.test.ts", 30, 50)];

  it("does not flag an intra-doc anchor link in a non-trailing parenthetical", () => {
    const md =
      "## A\n\nSee the matrix ([acceptance criteria](#acceptance-criteria)) below. ([t](src/x.test.ts#L42))\n";

    expect(collectBrokenLinks("specs/x/spec.md", md, chunks)).toEqual([]);
  });

  it("does not flag an absolute URL in a non-trailing parenthetical, even one containing .test.", () => {
    const md =
      "## A\n\nUpstream ([hapi](https://hapi.dev)) and a blob ([code](https://github.com/o/r/blob/sha/src/x.test.ts#L42)) mid-prose. ([t](src/x.test.ts#L42))\n";

    expect(collectBrokenLinks("specs/x/spec.md", md, chunks)).toEqual([]);
  });

  it("does not flag the path/to placeholder paths spec prose uses to document the convention", () => {
    const md =
      "## A\n\nLinks look like ([label](path/to/test.ts#L42)) or ([label](path/to/file.test.ts)) or ([label](path#Lline)) in prose. ([t](src/x.test.ts#L42))\n";

    expect(collectBrokenLinks("specs/x/spec.md", md, chunks)).toEqual([]);
  });

  it("does not flag an <owner>-style template URL in a non-trailing parenthetical", () => {
    const md =
      "## A\n\nBody contains ([git log](https://github.com/<owner>/<repo>/commits/<branch>)) as a template. ([t](src/x.test.ts#L42))\n";

    expect(collectBrokenLinks("specs/x/spec.md", md, chunks)).toEqual([]);
  });

  it("does not flag a mid-prose source-file reference link", () => {
    const md =
      "## A\n\nRegistered as exact ([registration](../../apps/api/src/server/build-server.ts#L98)) in the table. ([t](src/x.test.ts#L42))\n";

    expect(collectBrokenLinks("specs/x/spec.md", md, chunks)).toEqual([]);
  });

  it("does not flag a test link quoted inside an inline code span", () => {
    const md =
      "## A\n\n- An author who writes `It [does the thing](src/other.test.ts#L42).` mid-statement also gets the wrap. ([t](src/x.test.ts#L42))\n";

    expect(collectBrokenLinks("specs/x/spec.md", md, chunks)).toEqual([]);
  });

  it("does not fuse a prose bracket with the trailing parenthetical's first link", () => {
    const md =
      "## A\n\n- Rejects hours outside the `[start, end)` window and falls back on invalid env. ([t](src/x.test.ts#L42))\n";

    expect(collectBrokenLinks("specs/x/spec.md", md, chunks)).toEqual([]);
  });

  it("still flags a genuine test-file link buried mid-sentence as non-trailing-link", () => {
    const md = "## A\n\n- Returns ([t](src/x.test.ts#L42)) the value\n";

    expect(collectBrokenLinks("specs/x/spec.md", md, chunks)).toEqual([
      {
        spec_path: "specs/x/spec.md",
        statement_text: "Returns ([t](src/x.test.ts#L42)) the value",
        link: { label: "t", path: "src/x.test.ts", line: 42 },
        reason: "non-trailing-link",
      },
    ]);
  });
});
