import { describe, expect, it } from "vitest";
import { primerCache } from "./primer-cache.js";

function counting() {
  const written: string[] = [];
  const cache = primerCache(async (repo) => {
    written.push(repo);

    return `primer ${written.length} of ${repo}`;
  });

  return { cache, written };
}

describe("primerCache", () => {
  it("writes re-cinq/lore's primer once for two calls at head abc123", async () => {
    const { cache, written } = counting();

    await cache("re-cinq/lore", "abc123");
    const second = await cache("re-cinq/lore", "abc123");

    expect(second).toBe("primer 1 of re-cinq/lore");
    expect(written).toEqual(["re-cinq/lore"]);
  });

  it("writes a new primer after a push moves the head from abc123 to def456", async () => {
    const { cache } = counting();

    await cache("re-cinq/lore", "abc123");

    expect(await cache("re-cinq/lore", "def456")).toBe(
      "primer 2 of re-cinq/lore",
    );
  });

  it("writes again after a failed write instead of keeping the failure", async () => {
    const outcomes = [
      () => Promise.reject(new Error("model down")),
      () => Promise.resolve("primer"),
    ];
    const cache = primerCache(() =>
      (outcomes.shift() ?? (() => Promise.resolve("")))(),
    );

    await expect(cache("re-cinq/lore", "abc123")).rejects.toThrow(
      new Error("model down"),
    );
    expect(await cache("re-cinq/lore", "abc123")).toBe("primer");
  });
});
