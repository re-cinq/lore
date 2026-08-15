// The merged spec PR must wake the line that pushed it.
//
// `resumeDecomposition` existed and was correct, but nothing could call it for a
// spec PR: its only caller was `handleMergedTask`, reached only for tasks the
// mergeable sweep returns (`status IN ('pr-created','review') AND pr_number IS NOT
// NULL`). A feature-planning task is `running` with a null pr_number — the push node
// stamps the LINE's args, which is what `findOpenByPr` reads, and nothing copies it
// onto the task. So a merged spec PR decomposed on NO deployment: not by webhook,
// and not by the cron that is meant to be the webhook's safety net.

import { describe, it, expect, vi, beforeEach } from "vitest";

const findOpenByPr = vi.fn();
const listStationRuns = vi.fn();
const query = vi.fn();

vi.mock("../kernel/queues.js", () => ({
  assemblyLines: () => ({ findOpenByPr, listStationRuns }),
  settings: () => ({}),
  taskStore: () => ({}),
  taskQueue: () => ({}),
}));

vi.mock("../kernel/db.js", () => ({ getPool: () => ({ query }) }));

const { specPrResumeLine } = await import("./github.js");

const REPO = "re-cinq/lore";
const LINE = "c65cabb3-20e5-4dd8-97b9-372687858287";

const merged = (over: Record<string, unknown> = {}) => ({
  repo: REPO,
  pr_number: 1225,
  merged: true,
  branch: "spec/x",
  merge_commit_sha: "abc",
  labels: [],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  query.mockResolvedValue({ rows: [] });
  findOpenByPr.mockResolvedValue([{ id: LINE, status: "running" }]);
  listStationRuns.mockResolvedValue([
    { nodeId: "push", iteration: 1, outcome: "success" },
    { nodeId: "merged", iteration: 1, outcome: null },
  ]);
});

describe("specPrResumeLine", () => {
  it("finds the line by the PR number stamped on its args, not by a task row", async () => {
    await specPrResumeLine(merged());

    expect(findOpenByPr).toHaveBeenCalledWith(REPO, 1225);
  });

  it("reports the merge to the parked node, which is what resumes the walk", async () => {
    await specPrResumeLine(merged());

    expect(query).toHaveBeenCalled();
    expect(JSON.stringify(query.mock.calls)).toContain(LINE);
  });

  it("does nothing for a PR closed without merging", async () => {
    await specPrResumeLine(merged({ merged: false }));

    expect(findOpenByPr).not.toHaveBeenCalled();
  });

  it("does nothing when the line is parked on no wait node", async () => {
    listStationRuns.mockResolvedValue([
      { nodeId: "push", iteration: 1, outcome: "success" },
    ]);

    await specPrResumeLine(merged());

    expect(query).not.toHaveBeenCalled();
  });

  it("passes over a line that is not waiting for this PR at all", async () => {
    // A code-review line shares the PR. It never waited on `merged`, so advancing
    // it would push it through a step it never asked for.
    listStationRuns.mockResolvedValue([
      { nodeId: "review", iteration: 1, outcome: null },
    ]);

    await specPrResumeLine(merged());

    expect(query).not.toHaveBeenCalled();
  });

  it("does nothing when no open line carries the PR", async () => {
    findOpenByPr.mockResolvedValue([]);

    await specPrResumeLine(merged());

    expect(query).not.toHaveBeenCalled();
  });
});
