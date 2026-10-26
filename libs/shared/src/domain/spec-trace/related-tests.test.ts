import { describe, it, expect } from "vitest";
import { reachesEveryTest } from "./related-tests.js";

describe("reachesEveryTest", () => {
  it("returns false for a change to source and test files only", () => {
    expect(
      reachesEveryTest([
        "libs/shared/src/lib/backoff.ts",
        "libs/shared/src/lib/backoff.test.ts",
      ]),
    ).toBe(false);
  });

  it("returns true when a lockfile changed", () => {
    expect(
      reachesEveryTest(["apps/web-ui/package-lock.json", "README.md"]),
    ).toBe(true);
  });

  it("returns true when a vitest config or its shared helpers changed", () => {
    expect([
      reachesEveryTest(["apps/lore-api/vitest.config.ts"]),
      reachesEveryTest(["tools/vitest/workspace-source.ts"]),
    ]).toEqual([true, true]);
  });

  it("returns true when the test-command manifest or the trace scripts changed", () => {
    expect([
      reachesEveryTest([".lore/test-commands.yml"]),
      reachesEveryTest(["libs/shared/scripts/trace/run-test.mjs"]),
    ]).toEqual([true, true]);
  });
});
