import { describe, it, expect } from "vitest";
import {
  computeTransferScore,
  diversify,
  rrfMerge,
  scoreImportance,
} from "./memory-ranking.js";
import type { MemorySearchResult, RankedItem } from "./memory-ranking.js";

describe("rrfMerge", () => {
  it("carries confidence from the candidate onto the fused result", () => {
    const verifiedFact: RankedItem = {
      key: "k",
      value: "v",
      agent_id: "a",
      source: "fact",
      confidence: "verified",
    };

    const fused = rrfMerge([[verifiedFact]]);

    expect(fused).toContainEqual(
      expect.objectContaining({ key: "k", confidence: "verified" }),
    );
  });
});

describe("computeTransferScore", () => {
  it("returns 0.5 for neutral text with no portable or local keywords", () => {
    expect(computeTransferScore("the server processes requests")).toBe(0.5);
  });

  it("adds 0.15 per portable keyword above the base", () => {
    expect(computeTransferScore("a known error pattern")).toBeCloseTo(0.8, 5);
  });

  it("subtracts 0.15 per local keyword below the base", () => {
    expect(computeTransferScore("the deploy config")).toBeCloseTo(0.2, 5);
  });

  it("clamps to 1 when many portable keywords stack", () => {
    expect(computeTransferScore("error pattern gotcha rule convention")).toBe(
      1,
    );
  });

  it("clamps to 0 when many local keywords stack", () => {
    expect(computeTransferScore("config deploy url auth secret env")).toBe(0);
  });
});

describe("diversify", () => {
  it("keeps only the 3 highest-scoring from one agent_id::source over the cap", () => {
    const sameSource: MemorySearchResult[] = [
      { key: "k1", value: "v1", score: 0.9, agent_id: "a", source: "memory" },
      { key: "k2", value: "v2", score: 0.8, agent_id: "a", source: "memory" },
      { key: "k3", value: "v3", score: 0.7, agent_id: "a", source: "memory" },
      { key: "k4", value: "v4", score: 0.6, agent_id: "a", source: "memory" },
      { key: "k5", value: "v5", score: 0.5, agent_id: "a", source: "memory" },
    ];

    const kept = diversify(sameSource, 10, 3);

    expect(kept.map((result) => result.key)).toEqual(["k1", "k2", "k3"]);
  });

  it("caps each distinct agent_id::source independently", () => {
    const mixed: MemorySearchResult[] = [
      { key: "a1", value: "v", score: 0.9, agent_id: "a", source: "memory" },
      { key: "a2", value: "v", score: 0.85, agent_id: "a", source: "memory" },
      { key: "a3", value: "v", score: 0.8, agent_id: "a", source: "memory" },
      { key: "a4", value: "v", score: 0.75, agent_id: "a", source: "memory" },
      { key: "b1", value: "v", score: 0.7, agent_id: "b", source: "fact" },
    ];

    const kept = diversify(mixed, 10, 3);

    expect(kept.map((result) => result.key).sort()).toEqual([
      "a1",
      "a2",
      "a3",
      "b1",
    ]);
  });

  it("slices the total output to limit across all sources", () => {
    const items: MemorySearchResult[] = [
      { key: "a1", value: "v", score: 0.9, agent_id: "a", source: "memory" },
      { key: "b1", value: "v", score: 0.8, agent_id: "b", source: "fact" },
      { key: "c1", value: "v", score: 0.7, agent_id: "c", source: "episode" },
    ];

    expect(diversify(items, 2, 3).map((result) => result.key)).toEqual([
      "a1",
      "b1",
    ]);
  });

  it("keeps all items when each source is under the cap", () => {
    const items: MemorySearchResult[] = [
      { key: "a1", value: "v", score: 0.9, agent_id: "a", source: "memory" },
      { key: "a2", value: "v", score: 0.8, agent_id: "a", source: "memory" },
    ];

    expect(diversify(items, 10, 3).map((result) => result.key)).toEqual([
      "a1",
      "a2",
    ]);
  });
});

describe("scoreImportance", () => {
  it("returns 10 for a fresh memory with no score adjustments", () => {
    const createdAt = "2026-01-01T00:00:00.000Z";
    const freshMemory = {
      key: "deployment-gotchas-2026-01-01".replace("gotchas", "notes"),
      value:
        "A neutral observation about the staging server that sits between fifty and five hundred chars",
      created_at: createdAt,
      last_retrieved_at: null,
      half_life_days: 60,
      retrieval_count: 0,
      confidence: "observed",
    };
    const now = Date.parse(createdAt);

    expect(scoreImportance(freshMemory, now)).toBe(10);
  });

  const baseMemory = {
    key: "a-plain-key",
    value:
      "A neutral observation about the staging server that sits between fifty and five hundred chars",
    created_at: "2026-01-01T00:00:00.000Z",
    last_retrieved_at: null as string | null,
    half_life_days: 60,
    retrieval_count: 0,
    confidence: "observed" as string | null,
  };
  const HALF_LIFE_MS = 60 * 86400000;
  const atHalfLife = Date.parse(baseMemory.created_at) + HALF_LIFE_MS;

  it("decays to score 5 when effective age equals one half-life", () => {
    expect(scoreImportance(baseMemory, atHalfLife)).toBe(5);
  });

  it("subtracts 2 for a value shorter than 50 chars", () => {
    expect(
      scoreImportance(
        { ...baseMemory, value: "short" },
        Date.parse(baseMemory.created_at),
      ),
    ).toBe(8);
  });

  it("adds 2 for a key containing gotcha", () => {
    expect(
      scoreImportance({ ...baseMemory, key: "deploy-gotcha" }, atHalfLife),
    ).toBe(7);
  });

  it("subtracts 1 for stale confidence", () => {
    expect(
      scoreImportance({ ...baseMemory, confidence: "stale" }, atHalfLife),
    ).toBe(4);
  });

  it("uses last_retrieved_at over created_at for effective age", () => {
    const old = {
      ...baseMemory,
      created_at: "2020-01-01T00:00:00.000Z",
      last_retrieved_at: "2026-01-01T00:00:00.000Z",
    };
    expect(scoreImportance(old, Date.parse("2026-01-01T00:00:00.000Z"))).toBe(
      10,
    );
  });

  it("clamps to 0 when decay and penalties push below zero", () => {
    const ancient = Date.parse(baseMemory.created_at) + 10 * HALF_LIFE_MS;
    expect(
      scoreImportance(
        { ...baseMemory, value: "short", confidence: "stale" },
        ancient,
      ),
    ).toBe(0);
  });
});
