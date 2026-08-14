import { describe, it, expect } from "vitest";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  loadBuiltinAssemblyLines,
  memoizedPromise,
} from "./builtin-assembly-lines.js";

describe("loadBuiltinAssemblyLines", () => {
  it("returns the same promise across calls — the dir is baked into the image", () => {
    expect(loadBuiltinAssemblyLines()).toBe(loadBuiltinAssemblyLines());
  });

  it("resolves the builtin catalog including code-review", async () => {
    const definitions = await loadBuiltinAssemblyLines();

    expect(definitions.get("code-review")?.name).toBe("code-review");
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
