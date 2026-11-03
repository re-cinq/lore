import { describe, expect, it } from "vitest";
import type { SearchHit } from "@re-cinq/lore-shared/utopia/read-shapes.js";
import { previousWorkLines } from "./previous-work.js";

function hit(sourceId: string, externalId: string, text: string): SearchHit {
  return {
    chunkId: externalId,
    documentId: externalId,
    seq: 0,
    text,
    filename: `${externalId}.md`,
    sourceId,
    externalId,
    score: 1,
    bm25Rank: 1,
    vectorRank: 1,
  };
}

describe("previousWorkLines", () => {
  it("keeps the hits of the issues and pull-requests sources, once each, and drops a docs hit", () => {
    expect(
      previousWorkLines({
        tracker: [
          hit(
            "src-prs",
            "pr:2213",
            "Drop the single-text POST /api/embed (merged)",
          ),
          hit("src-docs", "doc:specs/x.md", "a spec passage"),
          hit(
            "src-prs",
            "pr:2213",
            "Drop the single-text POST /api/embed (merged)",
          ),
          hit("src-issues", "issue:2200", "Stations post batches"),
        ],
        trackerSources: ["src-issues", "src-prs"],
        memories: [],
      }),
    ).toEqual([
      "pr:2213: Drop the single-text POST /api/embed (merged)",
      "issue:2200: Stations post batches",
    ]);
  });

  it("reads memory hits from Lore's bare list and Utopia's results envelope alike", () => {
    const memory = {
      key: "session-summary/2026-09-28",
      value: "Batched embeddings shipped",
    };

    expect(
      previousWorkLines({
        tracker: [],
        trackerSources: [],
        memories: [memory],
      }),
    ).toEqual([
      "memory session-summary/2026-09-28: Batched embeddings shipped",
    ]);
    expect(
      previousWorkLines({
        tracker: [],
        trackerSources: [],
        memories: { results: [memory], notes: [] },
      }),
    ).toEqual([
      "memory session-summary/2026-09-28: Batched embeddings shipped",
    ]);
  });

  it("cuts a 2000-character memory to 600 characters", () => {
    const [line] = previousWorkLines({
      tracker: [],
      trackerSources: [],
      memories: [{ key: "k", value: "x".repeat(2000) }],
    });

    expect(line).toHaveLength("memory k: ".length + 600);
  });
});
