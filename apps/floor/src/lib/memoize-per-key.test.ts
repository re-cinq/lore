import { describe, it, expect } from "vitest";
import { memoizePerKey } from "./memoize-per-key.js";

describe("memoizePerKey", () => {
  it("builds re-cinq/lore once across three calls and hands back the same value", async () => {
    let builds = 0;
    const get = memoizePerKey(async (repo: string) => {
      builds++;

      return { repo };
    });

    const first = await get("re-cinq/lore");

    expect(await get("re-cinq/lore")).toBe(first);
    expect(await get("re-cinq/lore")).toBe(first);
    expect(builds).toBe(1);
  });

  it("builds once per distinct key", async () => {
    const built: string[] = [];
    const get = memoizePerKey(async (repo: string) => {
      built.push(repo);

      return { repo };
    });

    await Promise.all([get("o/a"), get("o/b"), get("o/a")]);

    expect(built).toEqual(["o/a", "o/b"]);
  });

  it("shares one in-flight build between callers that race for the same key, as several handlers do for one repo's installation-token round-trip inside one event", async () => {
    let builds = 0;
    const get = memoizePerKey(async (repo: string) => {
      builds++;
      await new Promise((resolve) => setTimeout(resolve, 5));

      return { repo };
    });

    const [a, b] = await Promise.all([get("o/a"), get("o/a")]);

    expect(a).toBe(b);
    expect(builds).toBe(1);
  });

  it("rebuilds after a rejection rather than caching the failure forever", async () => {
    const outcomes = [
      () => Promise.reject(new Error("github unreachable")),
      (repo: string) => Promise.resolve({ repo }),
    ];
    let attempt = 0;
    const get = memoizePerKey((repo: string) => outcomes[attempt++](repo));

    await expect(get("o/a")).rejects.toThrow(new Error("github unreachable"));

    expect(await get("o/a")).toEqual({ repo: "o/a" });
  });
});
