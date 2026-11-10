import { describe, it, expect } from "vitest";
import { filterCrossRepoMemories } from "./filter-memories";
import { type SearchResult } from "./SearchView";

describe("filterCrossRepoMemories", () => {
  it("verifies a selected repo cannot show another repo's memory/fact hits", () => {
    const hits: SearchResult[] = [
      {
        key: "1",
        value: "a",
        agent_id: "agent",
        score: 1,
        source: "memory",
        repo: "re-cinq/lore",
      },
      {
        key: "2",
        value: "b",
        agent_id: "agent",
        score: 1,
        source: "fact",
        repo: "re-cinq/atlas",
      },
      {
        key: "3",
        value: "c",
        agent_id: "agent",
        score: 1,
        source: "memory",
        repo: null,
      },
    ];

    const filtered = filterCrossRepoMemories(hits, "re-cinq/lore");

    expect(filtered.map((h) => h.key)).toEqual(["1", "3"]);
  });
});
