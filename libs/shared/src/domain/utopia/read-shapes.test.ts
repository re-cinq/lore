import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  parseSearchPage,
  parseStatementsChunk,
  parseStoredDocument,
  pushedPathOf,
  statementTexts,
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
  it("reads stmt:specs/utopia-graph-mirror/spec.md#0003 at version 2 with its content and no missing_since", () => {
    expect(
      parseStoredDocument(JSON.parse(fixture("stored-document.json"))),
    ).toEqual({
      id: "5c9d1e2f-3a4b-4c5d-8e6f-7a8b9c0d1e22",
      externalId: "stmt:specs/utopia-graph-mirror/spec.md#0003",
      filename: "stmt:specs/utopia-graph-mirror/spec.md#0003",
      status: "ready",
      docTime: "2026-10-15T10:00:00Z",
      missingSince: null,
      version: 2,
      content:
        '{\n  "external_id": "stmt:specs/utopia-graph-mirror/spec.md#0003"\n}',
    });
  });
});

describe("pushedPathOf", () => {
  it("returns stmt with path specs/utopia-graph-mirror/spec.md and ordinal 3 for stmt:specs/utopia-graph-mirror/spec.md#0003.2", () => {
    expect(
      pushedPathOf("stmt:specs/utopia-graph-mirror/spec.md#0003.2"),
    ).toEqual({
      kind: "stmt",
      path: "specs/utopia-graph-mirror/spec.md",
      ordinal: 3,
    });
  });

  it("returns doc and the ADR path for doc:adrs/ADR-052-x.md", () => {
    expect(pushedPathOf("doc:adrs/ADR-052-x.md")).toEqual({
      kind: "doc",
      path: "adrs/ADR-052-x.md",
    });
  });

  it("returns null for an external id of no known kind", () => {
    expect([
      pushedPathOf("page:wiki/home.md"),
      pushedPathOf("stmt:specs/utopia-graph-mirror/spec.md"),
    ]).toEqual([null, null]);
  });
});

describe("parseStatementsChunk", () => {
  it("reads the statement texts out of a pretty-printed statements chunk", () => {
    const chunk = parseStatementsChunk(fixture("statements-chunk.json"));

    expect({
      externalId: chunk?.externalId,
      texts: chunk && statementTexts(chunk),
    }).toEqual({
      externalId: "stmt:specs/utopia-graph-mirror/spec.md#0003",
      texts: ["A 404 reads as no document.", "A 422 is not retried."],
    });
  });

  it("returns null for a chunk cut mid-item", () => {
    expect(parseStatementsChunk('{\n  "external_id": "stmt:specs/x')).toBe(
      null,
    );
  });
});
