// The IO half of feature-run: the fetchers behind the wizard's poll. The pure
// shaping lives in feature-run.test.ts against real values; these tests pin the
// fetch orchestration — which lookups run, in what fallback order, and that a
// failure yields null rather than failing the poll.

import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchAssemblyRun = vi.fn();
const fetchAssemblyRunNodes = vi.fn();
const fetchLatestRunForTask = vi.fn();
const fetchRunTokens = vi.fn();

vi.mock("./assembly-runs", () => ({
  fetchAssemblyRun,
  fetchAssemblyRunNodes,
  fetchLatestRunForTask,
  fetchRunTokens,
}));

const { fetchFeatureRunById, fetchFeatureRun } = await import("./feature-run");

const run = {
  id: "run-1",
  blueprintName: "feature-planning",
  graph: null,
  taskId: "task-1",
  repo: "re-cinq/lore",
  branch: "feature/x",
  status: "running",
  outcome: null,
  reason: null,
  createdAt: "2026-08-14T10:00:00Z",
  startedAt: "2026-08-14T10:00:05Z",
  finishedAt: null,
  argsPrNumber: null,
  prUrl: null,
  taskPrNumber: null,
  createdBy: null,
  costUsd: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  fetchAssemblyRunNodes.mockResolvedValue([]);
  fetchRunTokens.mockResolvedValue(null);
});

describe("fetchFeatureRunById", () => {
  it("shapes the run lore-api resolved, with its nodes and tokens", async () => {
    fetchAssemblyRun.mockResolvedValue(run);

    const payload = await fetchFeatureRunById("run-1");

    expect(payload).toMatchObject({
      id: "run-1",
      status: "running",
      repo: "re-cinq/lore",
      nodes: [],
      tokens: null,
    });
    expect(fetchAssemblyRun).toHaveBeenCalledWith("run-1");
    expect(fetchAssemblyRunNodes).toHaveBeenCalledWith("run-1");
  });

  it("returns null for an absent line id without fetching anything", async () => {
    expect(await fetchFeatureRunById(null)).toBeNull();
    expect(await fetchFeatureRunById(undefined)).toBeNull();
    expect(fetchAssemblyRun).not.toHaveBeenCalled();
  });

  it("returns null when no run row exists yet", async () => {
    fetchAssemblyRun.mockResolvedValue(null);

    expect(await fetchFeatureRunById("run-9")).toBeNull();
  });

  it("returns null instead of throwing when the lookup fails — the poll must keep reporting", async () => {
    fetchAssemblyRun.mockRejectedValue(new Error("api down"));

    expect(await fetchFeatureRunById("run-1")).toBeNull();
  });
});

describe("fetchFeatureRun", () => {
  it("resolves the task's newest run and shapes it", async () => {
    fetchLatestRunForTask.mockResolvedValue(run);

    const payload = await fetchFeatureRun("task-1");

    expect(payload).toMatchObject({ id: "run-1", status: "running" });
    expect(fetchLatestRunForTask).toHaveBeenCalledWith("task-1");
  });

  it("returns null for a round with no task yet", async () => {
    expect(await fetchFeatureRun(null)).toBeNull();
    expect(fetchLatestRunForTask).not.toHaveBeenCalled();
  });

  it("returns null when the task has no run row", async () => {
    fetchLatestRunForTask.mockResolvedValue(null);

    expect(await fetchFeatureRun("task-1")).toBeNull();
  });

  it("returns null instead of throwing when the lookup fails", async () => {
    fetchLatestRunForTask.mockRejectedValue(new Error("api down"));

    expect(await fetchFeatureRun("task-1")).toBeNull();
  });
});
