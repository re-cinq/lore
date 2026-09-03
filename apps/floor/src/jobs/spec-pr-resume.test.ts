import { describe, it, expect, vi, beforeEach } from "vitest";

const findOpenByPr = vi.fn();
const listStationRuns = vi.fn();
const query = vi.fn();
const reported = vi.fn();

vi.mock("../kernel/queues.js", () => ({
  clusterAgent: () => ({}),
  pipeline: () => ({
    assemblyRuns: { findOpenByPr, listStationRuns },
    taskQueue: {},
  }),
  eventReporter: () => ({ insert: reported }),
  settings: () => ({}),
  taskStore: () => ({}),
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

    expect(reported).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "assembly_run.resume",
        source: "internal",
        params: expect.objectContaining({
          assemblyLineId: LINE,
          outcome: "success",
        }),
      }),
    );
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

  it("passes over a code-review line sharing the PR that never waited on `merged`", async () => {
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
