import { describe, it, expect } from "vitest";
import {
  documentPaths,
  documentText,
  liveDocumentPaths,
} from "./eval-documents.js";

type Call = { sql: string; params: unknown[] };

function scriptedPool(chunkRows: unknown[]) {
  const calls: Call[] = [];

  return {
    calls,
    query: async <T>(
      sql: string,
      params: unknown[] = [],
    ): Promise<{ rows: T[] }> => {
      calls.push({ sql, params });

      return { rows: (/\.chunks/.test(sql) ? chunkRows : []) as T[] };
    },
  };
}

const SPEC_HEAD = (status: string) =>
  `# Feature Specification: X\n\n| Field | Value |\n|---|---|\n| Status | ${status} |\n`;
const ADR_HEAD = (status: string) =>
  `---\nadr_number: 7\ntitle: "X"\nstatus: ${status}\n---\n\n# ADR-007`;

describe("liveDocumentPaths", () => {
  it("keeps a Shipped spec and an accepted ADR", () => {
    expect(
      liveDocumentPaths([
        { path: "specs/a/spec.md", head: SPEC_HEAD("Shipped") },
        { path: "adrs/ADR-007.md", head: ADR_HEAD("accepted") },
      ]),
    ).toEqual(["specs/a/spec.md", "adrs/ADR-007.md"]);
  });

  it("drops a Retired spec, a Rejected spec and a superseded ADR", () => {
    expect(
      liveDocumentPaths([
        { path: "specs/a/spec.md", head: SPEC_HEAD("Retired") },
        { path: "specs/b/spec.md", head: SPEC_HEAD("Rejected") },
        { path: "adrs/ADR-007.md", head: ADR_HEAD('"superseded"') },
      ]),
    ).toEqual([]);
  });

  it("keeps a document that states no status", () => {
    expect(
      liveDocumentPaths([{ path: "adrs/ADR-001.md", head: "# ADR-001" }]),
    ).toEqual(["adrs/ADR-001.md"]);
  });
});

describe("documentPaths", () => {
  it("reads the first chunk of every ADR and spec.md of re-cinq/lore from org_shared and returns the live ones", async () => {
    const pool = scriptedPool([
      { file_path: "adrs/ADR-007.md", head: ADR_HEAD("accepted") },
      { file_path: "specs/a/spec.md", head: SPEC_HEAD("Retired") },
    ]);

    expect(await documentPaths(pool, "re-cinq/lore")).toEqual([
      "adrs/ADR-007.md",
    ]);
    expect(pool.calls.at(-1)).toMatchObject({
      sql: expect.stringMatching(
        /DISTINCT ON \(file_path\)[\s\S]*FROM org_shared\.chunks[\s\S]*content_type = 'adr'[\s\S]*file_path LIKE '%spec\.md'/,
      ),
      params: ["re-cinq/lore"],
    });
  });
});

describe("documentText", () => {
  it("joins the chunks of adrs/ADR-007.md in order", async () => {
    const pool = scriptedPool([
      { content: "## Context\n\nWhy." },
      { content: "## Decision\n\nWhat." },
    ]);

    expect(await documentText(pool, "re-cinq/lore", "adrs/ADR-007.md")).toBe(
      "## Context\n\nWhy.\n\n## Decision\n\nWhat.",
    );
    expect(pool.calls.at(-1)?.params).toEqual([
      "re-cinq/lore",
      "adrs/ADR-007.md",
    ]);
  });

  it("returns null for a path with no ADR or spec chunks", async () => {
    const pool = scriptedPool([]);

    expect(
      await documentText(pool, "re-cinq/lore", "adrs/missing.md"),
    ).toBeNull();
  });
});
