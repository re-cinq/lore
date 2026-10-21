import { describe, expect, it } from "vitest";
import type { RunView } from "@re-cinq/floor-client";
import { LORE_BLOCKED_LABEL } from "./labels.js";
import {
  reapStuckLoopTasks,
  DEFAULT_REAP_RETRIES,
  reapRetriesFromEnv,
  type LoopReapDeps,
  type StuckTask,
} from "./loop-reap.js";

const task = (overrides: Partial<StuckTask> = {}): StuckTask => ({
  id: "task-1",
  target_repo: "re-cinq/lore",
  issue_number: 2016,
  created_at: "2026-10-07T17:58:00.000Z",
  updated_at: "2026-10-07T17:58:00.000Z",
  ...overrides,
});

function run(overrides: Partial<RunView> = {}): RunView {
  return {
    id: "run-1",
    lineId: "implementation-loop",
    lineHash: "hash-1",
    repo: "github.com/re-cinq/lore",
    subjectKey: "backlog:tickets",
    startItems: { task_id: { kind: "value", ref: "task-1", by: "lore" } },
    createdAt: "2026-10-07T17:58:00.000Z",
    outcome: null,
    reason: null,
    finishedAt: null,
    ...overrides,
  };
}

function deps(
  overrides: Partial<Omit<LoopReapDeps, "tasks">> = {},
  taskOverrides: Partial<LoopReapDeps["tasks"]> = {},
) {
  const flipped: Array<{ id: string; status: string; extra?: unknown }> = [];
  const events: Array<{ id: string; from: string; to: string }> = [];
  const comments: Array<{ repo: string; issueNumber: number; body: string }> =
    [];
  const labels: Array<{ repo: string; issueNumber: number; label: string }> =
    [];
  const base: LoopReapDeps = {
    floor: { runs: { list: async () => ({ items: [], nextCursor: null }) } },
    tasks: {
      findStuckRunning: async () => [task()],
      countRecentFailures: async () => 0,
      setStatusIf: async (id, _expected, status, extra) => {
        flipped.push({ id, status, extra });

        return true;
      },
      recordEvent: async (id, from, to) => {
        events.push({ id, from: from ?? "", to: to ?? "" });
      },
      ...taskOverrides,
    },
    comment: async (repo, issueNumber, body) => {
      comments.push({ repo, issueNumber, body });
    },
    addLabel: async (repo, issueNumber, label) => {
      labels.push({ repo, issueNumber, label });
    },
    maxRetries: DEFAULT_REAP_RETRIES,
    ...overrides,
  };

  return { deps: base, flipped, events, comments, labels };
}

describe("reapStuckLoopTasks", () => {
  it("fails a stuck task with no matching floor run, records the event, and comments without a label below the bound", async () => {
    const { deps: d, flipped, events, comments, labels } = deps();

    const result = await reapStuckLoopTasks(d);

    expect({ flipped, events, comments, labels, result }).toEqual({
      flipped: [
        {
          id: "task-1",
          status: "failed",
          extra: { failure_reason: expect.stringContaining("no floor run") },
        },
      ],
      events: [{ id: "task-1", from: "running", to: "failed" }],
      comments: [
        {
          repo: "re-cinq/lore",
          issueNumber: 2016,
          body: expect.stringContaining("attempt 1 of 3"),
        },
      ],
      labels: [],
      result: expect.stringContaining("reaped 1 of 1"),
    });
  });

  it("leaves a task alone when the floor has ANY run carrying its task_id, open or finished", async () => {
    const { deps: d, flipped } = deps({
      floor: { runs: { list: async () => ({ items: [run()], nextCursor: null }) } },
    });

    await reapStuckLoopTasks(d);

    expect(flipped).toEqual([]);
  });

  it("reaps the task when the only floor run found belongs to a different task_id", async () => {
    const otherTaskRun = run({
      startItems: { task_id: { kind: "value", ref: "task-2", by: "lore" } },
    });
    const { deps: d, flipped } = deps({
      floor: { runs: { list: async () => ({ items: [otherTaskRun], nextCursor: null }) } },
    });

    await reapStuckLoopTasks(d);

    expect(flipped).toHaveLength(1);
  });

  it("labels lore:blocked and words the comment as a stop, once the per-issue count reaches the bound", async () => {
    const { deps: d, labels, comments } = deps(
      {},
      { countRecentFailures: async () => DEFAULT_REAP_RETRIES - 1 },
    );

    await reapStuckLoopTasks(d);

    expect(labels).toEqual([
      {
        repo: "re-cinq/lore",
        issueNumber: 2016,
        label: LORE_BLOCKED_LABEL,
      },
    ]);
    expect(comments[0].body).toContain(
      `${DEFAULT_REAP_RETRIES} of ${DEFAULT_REAP_RETRIES}`,
    );
  });

  it("does nothing further when another caller already won the status flip", async () => {
    const { deps: d, events, comments } = deps(
      {},
      { setStatusIf: async () => false },
    );

    await reapStuckLoopTasks(d);

    expect(events).toEqual([]);
    expect(comments).toEqual([]);
  });

  it("flips the task even with no issue number, but skips the comment/label/count step", async () => {
    const { deps: d, flipped, comments } = deps(
      {},
      {
        findStuckRunning: async () => [task({ issue_number: null })],
        countRecentFailures: async () => {
          throw new Error("must not be called with no issue");
        },
      },
    );

    await reapStuckLoopTasks(d);

    expect(flipped).toHaveLength(1);
    expect(comments).toEqual([]);
  });
});

describe("reapRetriesFromEnv", () => {
  it("defaults to 3 when the env var is unset or not a positive integer", () => {
    expect(reapRetriesFromEnv({})).toBe(DEFAULT_REAP_RETRIES);
    expect(reapRetriesFromEnv({ LORE_LOOP_REAP_RETRIES: "0" })).toBe(
      DEFAULT_REAP_RETRIES,
    );
    expect(reapRetriesFromEnv({ LORE_LOOP_REAP_RETRIES: "nope" })).toBe(
      DEFAULT_REAP_RETRIES,
    );
  });

  it("reads a positive integer override", () => {
    expect(reapRetriesFromEnv({ LORE_LOOP_REAP_RETRIES: "5" })).toBe(5);
  });
});
