import { describe, expect, it, vi } from "vitest";
import type { UpgradeRunFloor } from "./upgrade-run.js";
import { upgradeFor, upgradeRun } from "./upgrade-run.js";

const START_ITEMS = {
  repo: { kind: "git", ref: "github.com/re-cinq/lore@main", by: "lore" },
};

function floor({
  latestHash = "latest",
  finishedAt = null,
  joined = false,
}: {
  latestHash?: string | null;
  finishedAt?: string | null;
  joined?: boolean;
} = {}) {
  return {
    runs: {
      get: vi.fn().mockResolvedValue({
        run: {
          id: "old-run",
          lineId: "code-review",
          lineHash: "old",
          repo: "github.com/re-cinq/lore",
          startItems: START_ITEMS,
          finishedAt,
        },
      }),
      cancel: vi.fn().mockResolvedValue({ id: "old-run" }),
    },
    lines: {
      get: vi.fn().mockResolvedValue(latestHash ? { hash: latestHash } : null),
      start: vi.fn().mockResolvedValue({ run: { id: "new-run" }, joined }),
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
      startItems: START_ITEMS,
      lineHash: "latest",
    });
  });

  it("cancels the still-open source run before starting the new one", async () => {
    const source = floor();

    await upgradeRun(source, "old-run");

    expect(source.runs.cancel).toHaveBeenCalledWith(
      "old-run",
      "upgraded to the latest assembly line",
    );
    expect(
      vi.mocked(source.runs.cancel).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(source.lines.start).mock.invocationCallOrder[0]);
  });

  it("cancels nothing for a source run that already finished", async () => {
    const source = floor({ finishedAt: "2026-10-07T09:00:00Z" });

    await upgradeRun(source, "old-run");

    expect(source.runs.cancel).not.toHaveBeenCalled();
  });

  it("refuses when the floor joins the open source run instead of starting one", async () => {
    await expect(
      upgradeRun(floor({ joined: true }), "old-run"),
    ).rejects.toThrow(
      "the floor joined the open run new-run instead of starting a new one",
    );
  });

  it("refuses when the run already has the latest line hash", async () => {
    await expect(
      upgradeRun(floor({ latestHash: "old" }), "old-run"),
    ).rejects.toThrow("this run already uses the latest assembly line");
  });

  it("refuses when the floor has no current line", async () => {
    await expect(
      upgradeRun(floor({ latestHash: null }), "old-run"),
    ).rejects.toThrow("the floor has no current line code-review");
  });
});
