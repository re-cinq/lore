import { describe, expect, it, vi } from "vitest";
import type { UpgradeRunFloor } from "./upgrade-run.js";
import { upgradeFor, upgradeRun } from "./upgrade-run.js";

const START_ITEMS = {
  repo: { kind: "git", ref: "github.com/re-cinq/lore@main", by: "lore" },
};

function floor({
  latestHash = "latest",
  finishedAt = null,
}: {
  latestHash?: string | null;
  finishedAt?: string | null;
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
      start: vi.fn().mockResolvedValue({
        run: { id: "new-run", lineHash: latestHash },
        joined: false,
      }),
    },
  } as unknown as UpgradeRunFloor;
}

function joining(lineHash: string): UpgradeRunFloor {
  const source = floor();

  vi.mocked(source.lines.start).mockResolvedValue({
    run: { id: "new-run", lineHash },
    joined: true,
  } as never);

  return source;
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

  it("answers with the joined run when it already runs the latest line", async () => {
    await expect(upgradeRun(joining("latest"), "old-run")).resolves.toEqual({
      runId: "new-run",
    });
  });

  it("refuses when the floor joins a run that is on an older line", async () => {
    await expect(upgradeRun(joining("older"), "old-run")).rejects.toThrow(
      "the floor joined the open run new-run, which is not on the latest assembly line",
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
