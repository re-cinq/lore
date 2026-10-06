import { describe, expect, it, vi } from "vitest";
import type { UpgradeRunFloor } from "./upgrade-run.js";
import { upgradeFor, upgradeRun } from "./upgrade-run.js";

function floor(latestHash: string | null = "latest") {
  return {
    runs: {
      get: vi.fn().mockResolvedValue({
        run: {
          id: "old-run",
          lineId: "code-review",
          lineHash: "old",
          repo: "github.com/re-cinq/lore",
          startItems: {
            repo: {
              kind: "git",
              ref: "github.com/re-cinq/lore@main",
              by: "lore",
            },
          },
        },
      }),
    },
    lines: {
      get: vi.fn().mockResolvedValue(latestHash ? { hash: latestHash } : null),
      start: vi.fn().mockResolvedValue({ run: { id: "new-run" } }),
    },
  } as unknown as UpgradeRunFloor;
}

describe("assembly run upgrades", () => {
  it("reports an upgrade when the latest line hash differs", async () => {
    await expect(upgradeFor(floor(), "old-run")).resolves.toEqual({
      available: true,
      latestHash: "latest",
    });
  });

  it("starts the latest line with the original run inputs", async () => {
    const source = floor();

    await expect(upgradeRun(source, "old-run")).resolves.toEqual({
      runId: "new-run",
    });
    expect(source.lines.start).toHaveBeenCalledWith("code-review", {
      repo: "github.com/re-cinq/lore",
      startItems: {
        repo: { kind: "git", ref: "github.com/re-cinq/lore@main", by: "lore" },
      },
      lineHash: "latest",
    });
  });

  it("refuses when the run already has the latest line hash", async () => {
    await expect(upgradeRun(floor("old"), "old-run")).rejects.toThrow(
      "this run already uses the latest assembly line",
    );
  });
});
