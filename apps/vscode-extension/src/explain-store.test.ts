import { describe, it, expect } from "vitest";
import {
  ExplainCache,
  placeEntries,
  type EntryStore,
  type ExplainEntry,
} from "./explain-store.js";
import type { Explanation } from "./lore-client.js";

class MapStore implements EntryStore {
  readonly values = new Map<string, unknown>();

  get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  async update(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }
}

const SPINS: Explanation = { answer: "It spins.", statements: [], model: "m" };

function clockFrom(start: number): () => number {
  let tick = start;

  return () => tick++;
}

describe("ExplainCache", () => {
  it("finds the explanation saved for src/w.ts and the same code", async () => {
    const cache = new ExplainCache(new MapStore());

    await cache.save("src/w.ts", "spin()", SPINS);

    expect(cache.find("src/w.ts", "spin()")?.explanation).toEqual(SPINS);
  });

  it("finds nothing once the code differs by one character", async () => {
    const cache = new ExplainCache(new MapStore());

    await cache.save("src/w.ts", "spin()", SPINS);

    expect(cache.find("src/w.ts", "spin(1)")).toBeUndefined();
  });

  it("keeps one entry when the same code is saved twice", async () => {
    const cache = new ExplainCache(new MapStore());

    await cache.save("src/w.ts", "spin()", SPINS);
    await cache.save("src/w.ts", "spin()", SPINS);

    expect(cache.entriesFor("src/w.ts")).toHaveLength(1);
  });

  it("reads entries a previous session saved to the same store", async () => {
    const store = new MapStore();

    await new ExplainCache(store).save("src/w.ts", "spin()", SPINS);

    expect(
      new ExplainCache(store).find("src/w.ts", "spin()")?.explanation,
    ).toEqual(SPINS);
  });

  it("drops the oldest entry when a third is saved over a limit of 2", async () => {
    const cache = new ExplainCache(new MapStore(), 2, clockFrom(1));

    await cache.save("src/w.ts", "a()", SPINS);
    await cache.save("src/w.ts", "b()", SPINS);
    await cache.save("src/w.ts", "c()", SPINS);

    expect(cache.entriesFor("src/w.ts").map((entry) => entry.code)).toEqual([
      "b()",
      "c()",
    ]);
  });
});

const entry = (code: string): ExplainEntry => ({
  path: "src/w.ts",
  code,
  explanation: SPINS,
  savedAt: 0,
});

describe("placeEntries", () => {
  it("places code found at lines 2-3 on lines 2-3", () => {
    expect(placeEntries([entry("b\nc")], "a\nb\nc\nd")).toEqual([
      { entry: entry("b\nc"), startLine: 2, endLine: 3 },
    ]);
  });

  it("follows code that moved down two lines", () => {
    expect(placeEntries([entry("b\nc")], "x\ny\na\nb\nc")).toEqual([
      { entry: entry("b\nc"), startLine: 4, endLine: 5 },
    ]);
  });

  it("drops code that changed", () => {
    expect(placeEntries([entry("b\nc")], "a\nb\nC")).toEqual([]);
  });

  it("matches code only where a line starts", () => {
    expect(placeEntries([entry("b")], "ab\nb")).toEqual([
      { entry: entry("b"), startLine: 2, endLine: 2 },
    ]);
  });

  it("places two entries of one file", () => {
    expect(
      placeEntries([entry("a"), entry("c")], "a\nb\nc").map(
        (placed) => placed.startLine,
      ),
    ).toEqual([1, 3]);
  });
});
