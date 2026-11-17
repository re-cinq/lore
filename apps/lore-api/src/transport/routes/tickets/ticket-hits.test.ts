import { describe, it, expect } from "vitest";
import type { SearchHit } from "@re-cinq/lore-shared/utopia/read-shapes.js";
import { ticketHitsOf } from "./ticket-hits.js";

const ISSUES_SOURCE = "src-issues";

const hit = (overrides: Partial<SearchHit>): SearchHit => ({
  chunkId: "chunk",
  documentId: "doc",
  seq: 0,
  text: "Issue: #12 in re-cinq/lore",
  filename: "issue-12.md",
  sourceId: ISSUES_SOURCE,
  externalId: "issue:12",
  score: 0.5,
  bm25Rank: 1,
  vectorRank: 1,
  ...overrides,
});

describe("ticketHitsOf", () => {
  it("returns issue #12 first for a query matching its title", () => {
    const hits = [
      hit({ externalId: "issue:3", score: 0.2, text: "unrelated" }),
      hit({ externalId: "issue:12", score: 0.9, text: "Search tickets" }),
    ];

    expect(ticketHitsOf(hits, ISSUES_SOURCE)).toEqual([
      { number: 12, score: 0.9, excerpt: "Search tickets" },
      { number: 3, score: 0.2, excerpt: "unrelated" },
    ]);
  });

  it("returns issue #12 once, with the text of its best-scoring chunk", () => {
    const hits = [
      hit({ score: 0.3, seq: 1, text: "body tail" }),
      hit({ score: 0.8, seq: 0, text: "title chunk" }),
    ];

    expect(ticketHitsOf(hits, ISSUES_SOURCE)).toEqual([
      { number: 12, score: 0.8, excerpt: "title chunk" },
    ]);
  });

  it("returns nothing for issue items of the test-coverage source and pull request hits", () => {
    const hits = [
      hit({ sourceId: "src-statements" }),
      hit({ externalId: "pr:12" }),
      hit({ externalId: null }),
    ];

    expect(ticketHitsOf(hits, ISSUES_SOURCE)).toEqual([]);
  });

  it("cuts an excerpt of 400 characters to 280 ending in an ellipsis", () => {
    const [ticket] = ticketHitsOf(
      [hit({ text: "x".repeat(400) })],
      ISSUES_SOURCE,
    );

    expect(ticket?.excerpt).toBe(`${"x".repeat(279)}…`);
  });
});
