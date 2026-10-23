import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  docPathOf,
  parseSearchPage,
  parseStoredDocument,
} from "./read-shapes.js";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf-8");

describe("parseSearchPage", () => {
  it("parses a scored search page into hits with source_id and external_id, null ranks kept as null", () => {
    const page = parseSearchPage(JSON.parse(fixture("search-page.json")));

    expect(page).toEqual({
      hits: [
        {
          chunkId: "0b7e3c1a-2f4d-4c8e-9a51-6d2f0e8b7c11",
          documentId: "5c9d1e2f-3a4b-4c5d-8e6f-7a8b9c0d1e22",
          seq: 0,
          text: '{\n  "external_id": "stmt:specs/utopia-graph-mirror/spec.md#0003.2"\n}',
          filename: "stmt:specs/utopia-graph-mirror/spec.md#0003.2",
          sourceId: "9e8d7c6b-5a49-4382-b1a0-f9e8d7c6b533",
          externalId: "stmt:specs/utopia-graph-mirror/spec.md#0003.2",
          score: 0.0325,
          bm25Rank: 1,
          vectorRank: null,
        },
        {
          chunkId: "1c8f4d2b-3e5a-4d9f-8b62-7e3f1a9c8d44",
          documentId: "6dae2f30-4b5c-4d6e-9f70-8b9cad1e2f55",
          seq: 4,
          text: "Retention notes uploaded by hand",
          filename: "retention.md",
          sourceId: null,
          externalId: null,
          score: 0.0161,
          bm25Rank: null,
          vectorRank: 2,
        },
      ],
      hasMore: true,
      vectorUsed: true,
    });
  });
});

describe("parseStoredDocument", () => {
  it("reads stmt:specs/utopia-graph-mirror/spec.md#0003 at version 2 with its content from a response without missing_since", () => {
    expect(
      parseStoredDocument(JSON.parse(fixture("stored-document.json"))),
    ).toEqual({
      id: "5c9d1e2f-3a4b-4c5d-8e6f-7a8b9c0d1e22",
      externalId: "stmt:specs/utopia-graph-mirror/spec.md#0003",
      filename: "stmt:specs/utopia-graph-mirror/spec.md#0003",
      status: "ready",
      docTime: "2026-10-15T10:00:00Z",
      version: 2,
      content:
        '{\n  "external_id": "stmt:specs/utopia-graph-mirror/spec.md#0003"\n}',
    });
  });
});

describe("docPathOf", () => {
  it("returns the ADR path for doc:adrs/ADR-052-x.md", () => {
    expect(docPathOf("doc:adrs/ADR-052-x.md")).toBe("adrs/ADR-052-x.md");
  });

  it("returns null for stmt:, commit: and page: ids, which are no pushed document of a file", () => {
    expect([
      docPathOf("stmt:specs/utopia-graph-mirror/spec.md#0003"),
      docPathOf("commit:7b89df02"),
      docPathOf("page:wiki/home.md"),
    ]).toEqual([null, null, null]);
  });
});
