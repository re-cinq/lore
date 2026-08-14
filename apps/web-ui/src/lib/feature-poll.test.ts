// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const getFeatureStatus = vi.fn();
const getTask = vi.fn();
const fetchFeatureRunById = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/features", () => ({ getFeatureStatus }));
vi.mock("@/lib/api/tasks", () => ({ getTask }));
vi.mock("@/lib/feature-run", () => ({ fetchFeatureRunById }));
vi.mock("@/lib/station-conversation", () => ({
  formatStationConversation: (raw: string) => raw,
}));

const { loadFeaturePoll } = await import("./feature-poll");

/** The one call the loader makes for the round's state. */
function answerStatus(data: {
  feature?: unknown;
  latest_iteration?: unknown;
  last_ready_iteration?: unknown;
  assembly_line_id?: string | null;
}) {
  getFeatureStatus.mockResolvedValue({
    status: "ok",
    data: {
      feature: data.feature ?? { id: "f1" },
      latest_iteration: data.latest_iteration ?? null,
      last_ready_iteration: data.last_ready_iteration ?? null,
      assembly_line_id: data.assembly_line_id ?? null,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchFeatureRunById.mockResolvedValue(null);
  getTask.mockResolvedValue({ status: "error", message: "not found" });
});

describe("loadFeaturePoll", () => {
  it("returns null when the repo holds no such feature", async () => {
    getFeatureStatus.mockResolvedValue({
      status: "error",
      message: "feature not found",
      code: 404,
    });

    expect(await loadFeaturePoll("re-cinq/lore", "nope")).toEqual(null);
  });

  it("scopes the lookup to the repo in the path", async () => {
    answerStatus({});

    await loadFeaturePoll("re-cinq/lore", "f1");

    expect(getFeatureStatus).toHaveBeenCalledWith("re-cinq/lore", "f1");
  });

  it("returns a null task when the latest round names no task", async () => {
    answerStatus({ latest_iteration: { iteration: 2 } });

    expect(await loadFeaturePoll("re-cinq/lore", "f1")).toMatchObject({
      latestIteration: { iteration: 2 },
      task: null,
      liveOutput: null,
    });
  });

  it("carries the task status and failure reason of the latest round", async () => {
    answerStatus({ latest_iteration: { iteration: 2, task_id: "t9" } });
    getTask.mockResolvedValue({
      status: "ok",
      data: { status: "failed", failure_reason: "timeout" },
    });

    expect(await loadFeaturePoll("re-cinq/lore", "f1")).toMatchObject({
      task: { status: "failed", failure_reason: "timeout" },
    });
  });

  it("returns no live output for a task that is not running", async () => {
    answerStatus({ latest_iteration: { iteration: 2, task_id: "t9" } });
    getTask.mockResolvedValue({
      status: "ok",
      data: { status: "failed", failure_reason: null },
    });

    expect((await loadFeaturePoll("re-cinq/lore", "f1"))?.liveOutput).toEqual(
      null,
    );
  });

  it("returns no live output when no station log exists for a running task", async () => {
    answerStatus({
      latest_iteration: { iteration: 2, task_id: "no-such-task-log" },
    });
    getTask.mockResolvedValue({
      status: "ok",
      data: { status: "running", failure_reason: null },
    });

    expect((await loadFeaturePoll("re-cinq/lore", "f1"))?.liveOutput).toEqual(
      null,
    );
  });

  it("returns the most recent round that produced an analysis as lastReady", async () => {
    answerStatus({
      latest_iteration: { iteration: 4 },
      last_ready_iteration: { iteration: 3, gap_result: { sections: [] } },
    });

    expect(await loadFeaturePoll("re-cinq/lore", "f1")).toMatchObject({
      lastReady: { iteration: 3 },
    });
  });

  it("draws the run from the line the server resolved for the round", async () => {
    // From round 2 a resumed round mints no task, so only lore-api — which knows
    // the OWNING task — can name the line. The loader no longer guesses it.
    answerStatus({
      latest_iteration: { iteration: 4, task_id: "t4" },
      assembly_line_id: "line-7",
    });
    fetchFeatureRunById.mockResolvedValue({ status: "running" });

    expect((await loadFeaturePoll("re-cinq/lore", "f1"))?.run).toEqual({
      status: "running",
    });
    expect(fetchFeatureRunById).toHaveBeenCalledWith("line-7");
  });

  it("draws no run for a round whose feature has no line yet", async () => {
    answerStatus({ latest_iteration: { iteration: 1 } });

    expect((await loadFeaturePoll("re-cinq/lore", "f1"))?.run).toEqual(null);
    expect(fetchFeatureRunById).toHaveBeenCalledWith(null);
  });
});
