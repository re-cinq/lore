import { describe, expect, it } from "vitest";
import { loopPullReads, type LoopPulls } from "./loop-pull-reads.js";

function countingPulls(asked: string[]): LoopPulls {
  return {
    list: async () => {
      asked.push("list");

      return [];
    },
    listMergedSince: async (since: string) => {
      asked.push(`merged since ${since}`);

      return [];
    },
    listChecks: async (sha: string) => {
      asked.push(`checks ${sha}`);

      return [];
    },
  } as unknown as LoopPulls;
}

describe("loopPullReads", () => {
  it("lists re-cinq/lore's open pull requests, its week of merges and the checks of abc once for two routes within 20 seconds", async () => {
    const asked: string[] = [];
    const now = Date.parse("2026-10-24T12:00:00Z");
    const reads = loopPullReads(() => now);
    const pulls = countingPulls(asked);

    for (let route = 0; route < 2; route++) {
      await reads.openPulls("re-cinq/lore", pulls);
      await reads.mergedThisWeek("re-cinq/lore", pulls);
      await reads.checksOf("re-cinq/lore", "abc", pulls);
    }

    expect(asked).toEqual([
      "list",
      "merged since 2026-10-17T12:00:00.000Z",
      "checks abc",
    ]);
  });

  it("reads the checks of abc and def separately, and lists the open pull requests again after 20 seconds", async () => {
    const asked: string[] = [];
    let now = 0;
    const reads = loopPullReads(() => now);
    const pulls = countingPulls(asked);

    await reads.checksOf("re-cinq/lore", "abc", pulls);
    await reads.checksOf("re-cinq/lore", "def", pulls);
    await reads.openPulls("re-cinq/lore", pulls);
    now = 20_001;
    await reads.openPulls("re-cinq/lore", pulls);

    expect(asked).toEqual(["checks abc", "checks def", "list", "list"]);
  });
});
