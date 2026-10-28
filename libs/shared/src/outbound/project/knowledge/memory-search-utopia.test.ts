import { describe, it, expect } from "vitest";
import type { SearchHit } from "../../../domain/utopia/read-shapes.js";
import {
  memoryExternalId,
  normalizeHitScores,
  utopiaMemoryHits,
} from "./memory-search-utopia.js";

const MEMORIES = "11111111-1111-1111-1111-111111111111";
const EPISODES = "22222222-2222-2222-2222-222222222222";
const SOURCES = { memories: MEMORIES, episodes: EPISODES };

function hit(
  externalId: string,
  text: string,
  score: number,
  options: { seq?: number; sourceId?: string } = {},
): SearchHit {
  return {
    chunkId: `c-${externalId}-${options.seq ?? 0}`,
    documentId: `d-${externalId}`,
    seq: options.seq ?? 0,
    text,
    filename: externalId,
    sourceId: options.sourceId ?? MEMORIES,
    externalId,
    score,
    bm25Rank: null,
    vectorRank: 1,
  };
}

describe("memoryExternalId", () => {
  it("parses memory:claude-bogdan/deployment-gotchas-2026-10-19 into agent claude-bogdan and that key", () => {
    expect(
      memoryExternalId("memory:claude-bogdan/deployment-gotchas-2026-10-19"),
    ).toEqual({
      kind: "memory",
      agentId: "claude-bogdan",
      key: "deployment-gotchas-2026-10-19",
    });
  });

  it("parses episode:abc-123 into episode id abc-123", () => {
    expect(memoryExternalId("episode:abc-123")).toEqual({
      kind: "episode",
      id: "abc-123",
    });
  });

  it("returns null for doc:specs/x/spec.md", () => {
    expect(memoryExternalId("doc:specs/x/spec.md")).toBeNull();
  });

  it("keeps a slash inside the key: memory:a/consolidated/re-cinq/lore/2026 has key consolidated/re-cinq/lore/2026", () => {
    expect(memoryExternalId("memory:a/consolidated/re-cinq/lore/2026")).toEqual(
      {
        kind: "memory",
        agentId: "a",
        key: "consolidated/re-cinq/lore/2026",
      },
    );
  });
});

describe("utopiaMemoryHits", () => {
  const filter = { limit: 10 };

  it("maps a memories-source hit to {key, agent_id, source memory, backend utopia} with the key line removed from the value", () => {
    const hits = [
      hit(
        "memory:claude-bogdan/gotchas",
        "gotchas\n\nGKE egress must open node-local-dns.",
        0.8,
      ),
    ];

    expect(utopiaMemoryHits(hits, SOURCES, filter)).toEqual([
      {
        key: "gotchas",
        agent_id: "claude-bogdan",
        value: "GKE egress must open node-local-dns.",
        score: 0.8,
        source: "memory",
        backend: "utopia",
      },
    ]);
  });

  it("maps an episodes-source hit to {key episode-<id>, id, source episode, agent_id empty}", () => {
    const hits = [
      hit("episode:e-1", "Session in re-cinq/lore", 0.5, {
        sourceId: EPISODES,
      }),
    ];

    expect(utopiaMemoryHits(hits, SOURCES, filter)).toEqual([
      {
        key: "episode-e-1",
        id: "e-1",
        agent_id: "",
        value: "Session in re-cinq/lore",
        score: 0.5,
        source: "episode",
        backend: "utopia",
      },
    ]);
  });

  it("drops a hit of another source and a doc: id", () => {
    const hits = [
      hit("memory:a/k", "k\n\nv", 0.9, { sourceId: "other" }),
      hit("doc:specs/a.md", "text", 0.8),
    ];

    expect(utopiaMemoryHits(hits, SOURCES, filter)).toEqual([]);
  });

  it("drops memories of other agents and every episode when agentId claude-bogdan is asked for", () => {
    const hits = [
      hit("memory:claude-bogdan/mine", "mine\n\nv", 0.9),
      hit("memory:someone-else/theirs", "theirs\n\nv", 0.8),
      hit("episode:e-1", "text", 0.7, { sourceId: EPISODES }),
    ];

    expect(
      utopiaMemoryHits(hits, SOURCES, { agentId: "claude-bogdan", limit: 10 }),
    ).toMatchObject([{ key: "mine" }]);
  });

  it("joins two chunks of one memory in seq order and scores the document by its best-ranked chunk", () => {
    const hits = [
      hit("memory:a/long", "second chunk", 0.8, { seq: 1 }),
      hit("memory:a/long", "long\n\nfirst chunk", 0.6, { seq: 0 }),
      hit("memory:a/short", "short\n\nv", 0.4),
    ];

    expect(
      utopiaMemoryHits(hits, SOURCES, filter).map(({ key, value, score }) => ({
        key,
        value,
        score,
      })),
    ).toEqual([
      { key: "long", value: "first chunk\nsecond chunk", score: 0.8 },
      { key: "short", value: "v", score: 0.4 },
    ]);
  });

  it("cuts to the limit after grouping", () => {
    const hits = [
      hit("memory:a/one", "one\n\nv", 0.9),
      hit("memory:a/two", "two\n\nv", 0.8),
      hit("memory:a/three", "three\n\nv", 0.7),
    ];

    expect(
      utopiaMemoryHits(hits, SOURCES, { limit: 2 }).map(({ key }) => key),
    ).toEqual(["one", "two"]);
  });

  it("answers no hits when the base has no sources yet", () => {
    const hits = [hit("memory:a/k", "k\n\nv", 0.9)];

    expect(
      utopiaMemoryHits(hits, { memories: null, episodes: null }, filter),
    ).toEqual([]);
  });
});

describe("normalizeHitScores", () => {
  it("scales scores 0.9 and 0.45 to 1 and 0.5", () => {
    const hits = utopiaMemoryHits(
      [
        hit("memory:a/one", "one\n\nv", 0.9),
        hit("memory:a/two", "two\n\nv", 0.45),
      ],
      SOURCES,
      { limit: 10 },
    );

    expect(normalizeHitScores(hits).map(({ score }) => score)).toEqual([
      1, 0.5,
    ]);
  });

  it("leaves no hits as no hits", () => {
    expect(normalizeHitScores([])).toEqual([]);
  });
});
