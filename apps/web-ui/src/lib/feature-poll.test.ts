// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const queryAllowMissing = vi.fn();
const fetchFeatureRun = vi.fn();
const runTaskIdFor = vi.fn();

vi.mock("@/lib/db", () => ({ queryAllowMissing }));
vi.mock("@/lib/feature-run", () => ({ fetchFeatureRun, runTaskIdFor }));
vi.mock("@/lib/station-conversation", () => ({
  formatStationConversation: (raw: string) => raw,
}));

const { loadFeaturePoll } = await import("./feature-poll");

/** Answers each SELECT by the table it names, in the order the loader asks. */
function answerQueries(rows: {
  feature?: unknown[];
  latest?: unknown[];
  task?: unknown[];
  ready?: unknown[];
  owning?: unknown[];
}) {
  queryAllowMissing.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM lore.features")) {
      return rows.feature ?? [];
    }

    if (sql.includes("FROM pipeline.tasks")) {
      return rows.task ?? [];
    }

    if (sql.includes("gap_result IS NOT NULL")) {
      return rows.ready ?? [];
    }

    if (sql.includes("task_id IS NOT NULL")) {
      return rows.owning ?? [];
    }

    return rows.latest ?? [];
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchFeatureRun.mockResolvedValue(null);
  runTaskIdFor.mockReturnValue(null);
});

describe("loadFeaturePoll", () => {
  it("returns null when the repo holds no such feature", async () => {
    answerQueries({ feature: [] });

    expect(await loadFeaturePoll("re-cinq/lore", "nope")).toEqual(null);
  });

  it("scopes the feature lookup to the repo in the path", async () => {
    answerQueries({ feature: [{ id: "f1" }] });

    await loadFeaturePoll("re-cinq/lore", "f1");

    expect(queryAllowMissing.mock.calls[0]?.[1]).toEqual([
      "f1",
      "re-cinq/lore",
    ]);
  });

  it("returns a null task when the latest round names no task", async () => {
    answerQueries({ feature: [{ id: "f1" }], latest: [{ iteration: 2 }] });

    expect(await loadFeaturePoll("re-cinq/lore", "f1")).toMatchObject({
      latestIteration: { iteration: 2 },
      task: null,
      liveOutput: null,
    });
  });

  it("carries the task status and failure reason of the latest round", async () => {
    answerQueries({
      feature: [{ id: "f1" }],
      latest: [{ iteration: 2, task_id: "t9" }],
      task: [{ status: "failed", failure_reason: "timeout" }],
    });

    expect(await loadFeaturePoll("re-cinq/lore", "f1")).toMatchObject({
      task: { status: "failed", failure_reason: "timeout" },
    });
  });

  it("returns no live output for a task that is not running", async () => {
    answerQueries({
      feature: [{ id: "f1" }],
      latest: [{ iteration: 2, task_id: "t9" }],
      task: [{ status: "failed", failure_reason: null }],
    });

    expect((await loadFeaturePoll("re-cinq/lore", "f1"))?.liveOutput).toEqual(
      null,
    );
  });

  it("returns no live output when no station log exists for a running task", async () => {
    answerQueries({
      feature: [{ id: "f1" }],
      latest: [{ iteration: 2, task_id: "no-such-task-log" }],
      task: [{ status: "running", failure_reason: null }],
    });

    expect((await loadFeaturePoll("re-cinq/lore", "f1"))?.liveOutput).toEqual(
      null,
    );
  });

  it("returns the most recent round that produced an analysis as lastReady", async () => {
    answerQueries({
      feature: [{ id: "f1" }],
      latest: [{ iteration: 4 }],
      ready: [{ iteration: 3, gap_result: { sections: [] } }],
    });

    expect(await loadFeaturePoll("re-cinq/lore", "f1")).toMatchObject({
      lastReady: { iteration: 3 },
    });
  });

  it("resolves the run from the round's task and the line-owning task", async () => {
    answerQueries({
      feature: [{ id: "f1" }],
      latest: [{ iteration: 4, task_id: "t4" }],
      task: [{ status: "running", failure_reason: null }],
      owning: [{ task_id: "t1" }],
    });
    runTaskIdFor.mockReturnValue("t1");
    fetchFeatureRun.mockResolvedValue({ status: "running" });

    expect((await loadFeaturePoll("re-cinq/lore", "f1"))?.run).toEqual({
      status: "running",
    });
    expect(runTaskIdFor).toHaveBeenCalledWith({
      latestIterationTaskId: "t4",
      owningTaskId: "t1",
    });
  });

  it("resolves no run when neither the round nor the feature names a task", async () => {
    answerQueries({ feature: [{ id: "f1" }], latest: [{ iteration: 1 }] });

    expect((await loadFeaturePoll("re-cinq/lore", "f1"))?.run).toEqual(null);
    expect(runTaskIdFor).toHaveBeenCalledWith({
      latestIterationTaskId: undefined,
      owningTaskId: undefined,
    });
  });
});
