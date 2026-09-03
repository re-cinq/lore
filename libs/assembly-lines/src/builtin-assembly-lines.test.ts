import { describe, it, expect } from "vitest";
import { readdir } from "node:fs/promises";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  loadBuiltinAssemblyLines,
  memoizedPromise,
} from "./builtin-assembly-lines.js";
import { getNextTransition } from "./transition.js";

describe("loadBuiltinAssemblyLines", () => {
  it("returns the same promise across calls — the dir is baked into the image", () => {
    expect(loadBuiltinAssemblyLines()).toBe(loadBuiltinAssemblyLines());
  });

  it("resolves the builtin catalog including code-review", async () => {
    const definitions = await loadBuiltinAssemblyLines();

    expect(definitions.get("code-review")?.name).toBe("code-review");
  });

  it("loads every YAML in the directory, none skipped", async () => {
    // The schemas are strict, so an undeclared key in any shipped recipe is a load
    // failure rather than a silently dropped field. Counting the files keeps that
    // honest: a per-file catch that swallowed one would leave the map short, and
    // "the catalog resolved" alone would not notice.
    const dir = new URL("./assembly-lines/", import.meta.url);
    const yamlCount = (await readdir(dir)).filter((f) =>
      f.endsWith(".yaml"),
    ).length;

    expect((await loadBuiltinAssemblyLines()).size).toBe(yamlCount);
  });

  // PR #1714 merged five minutes after its only review visit failed (the
  // findings block did not parse): `failed` routed straight to `done`, so the
  // run COMPLETED and the one red check was all that ever said a review never
  // happened. A parse flake is retryable; a second identical failure is not.
  it("retries a failed code-review visit once, then fails the run instead of completing it", async () => {
    const line = (await loadBuiltinAssemblyLines()).get("code-review");

    expect(
      getNextTransition(line!, [
        { nodeId: "review", iteration: 1, outcome: "failed" },
      ]),
    ).toEqual({ kind: "launch", nodeId: "review", iteration: 2 });
    expect(
      getNextTransition(line!, [
        { nodeId: "review", iteration: 1, outcome: "failed" },
        { nodeId: "review", iteration: 2, outcome: "failed" },
      ]),
    ).toMatchObject({ kind: "fail", outcome: "iteration_max" });
  });

  it("retries a failed code-review-recheck visit once, then fails the run instead of completing it", async () => {
    const line = (await loadBuiltinAssemblyLines()).get("code-review-recheck");

    expect(
      getNextTransition(line!, [
        { nodeId: "recheck", iteration: 1, outcome: "failed" },
      ]),
    ).toEqual({ kind: "launch", nodeId: "recheck", iteration: 2 });
    expect(
      getNextTransition(line!, [
        { nodeId: "recheck", iteration: 1, outcome: "failed" },
        { nodeId: "recheck", iteration: 2, outcome: "failed" },
      ]),
    ).toMatchObject({ kind: "fail", outcome: "iteration_max" });
  });
});

describe("memoizedPromise", () => {
  it("runs the load once and hands every caller the same promise", async () => {
    let calls = 0;
    const memoized = memoizedPromise(async () => {
      calls += 1;

      return "loaded";
    });

    expect(await memoized()).toBe("loaded");
    expect(await memoized()).toBe("loaded");
    expect(calls).toBe(1);
  });

  it("evicts a rejection so a transient failure does not poison the process", async () => {
    let calls = 0;
    const memoized = memoizedPromise(async () => {
      calls += 1;

      enforceTrue(calls !== 1, Error, "transient I/O");

      return "recovered";
    });

    await expect(memoized()).rejects.toThrow(new Error("transient I/O"));
    expect(await memoized()).toBe("recovered");
    expect(calls).toBe(2);
  });
});
