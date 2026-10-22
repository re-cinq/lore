import { describe, expect, it } from "vitest";
import type { RunView } from "@re-cinq/floor-client";
import { LORE_BLOCKED_LABEL } from "./labels.js";
import {
  issueNumberFromLoopBranch,
  settleMergedLoopTicket,
  type MergeSuccessDeps,
} from "./loop-merge-success.js";

describe("issueNumberFromLoopBranch", () => {
  it("reads 42 from lore/implementation-loop/issue-42", () => {
    expect(issueNumberFromLoopBranch("lore/implementation-loop/issue-42")).toBe(
      42,
    );
  });

  it("returns null for a branch that is not a loop ticket's", () => {
    expect(issueNumberFromLoopBranch("feature/widgets")).toBeNull();
  });
});

function run(overrides: Partial<RunView> = {}): RunView {
  return {
    id: "run-1",
    lineId: "implementation-loop",
    lineHash: "hash-1",
    repo: "github.com/acme/widgets",
    subjectKey: "backlog:tickets",
    startItems: { task_id: { kind: "value", ref: "task-1", by: "lore" } },
    createdAt: "2026-10-21T10:00:00.000Z",
    outcome: null,
    reason: null,
    finishedAt: null,
    ...overrides,
  };
}

function deps(overrides: Partial<MergeSuccessDeps> = {}) {
  const cancelled: Array<{ runId: string; reason: string }> = [];
  const flipped: Array<{ id: string; status: string }> = [];
  const events: Array<{ id: string; from: string; to: string }> = [];
  const labelsRemoved: Array<{
    repo: string;
    issueNumber: number;
    label: string;
  }> = [];
  const comments: Array<{ repo: string; issueNumber: number; body: string }> =
    [];
  const closed: Array<{ repo: string; issueNumber: number }> = [];
  const ticked: string[] = [];
  const base: MergeSuccessDeps = {
    floor: () => ({
      runs: {
        list: async () => ({ items: [], nextCursor: null }),
        cancel: async (runId: string, reason: string) => {
          cancelled.push({ runId, reason });

          return run();
        },
      },
    }),
    tasks: {
      latestLoopTaskByIssue: async () => ({ id: "task-1", status: "running" }),
      setStatusIf: async (id, _from, status) => {
        flipped.push({ id, status });

        return true;
      },
      recordEvent: async (id, from, to) => {
        events.push({ id, from: from ?? "", to: to ?? "" });
      },
    },
    comment: async (repo, issueNumber, body) => {
      comments.push({ repo, issueNumber, body });
    },
    removeLabel: async (repo, issueNumber, label) => {
      labelsRemoved.push({ repo, issueNumber, label });
    },
    closeIssue: async (repo, issueNumber) => {
      closed.push({ repo, issueNumber });
    },
    emitTick: async (repo) => {
      ticked.push(repo);
    },
    ...overrides,
  };

  return {
    deps: base,
    cancelled,
    flipped,
    events,
    labelsRemoved,
    comments,
    closed,
    ticked,
  };
}

const REPO = "acme/widgets";
const BRANCH = "lore/implementation-loop/issue-7";

describe("settleMergedLoopTicket", () => {
  it("marks the active task merged, clears the block, comments, closes the issue and re-arms the loop", async () => {
    const {
      deps: d,
      flipped,
      events,
      labelsRemoved,
      comments,
      closed,
      ticked,
    } = deps();

    const result = await settleMergedLoopTicket(d, REPO, BRANCH);

    expect({
      flipped,
      events,
      labelsRemoved,
      comments,
      closed,
      ticked,
    }).toEqual({
      flipped: [{ id: "task-1", status: "merged" }],
      events: [{ id: "task-1", from: "running", to: "merged" }],
      labelsRemoved: [
        { repo: REPO, issueNumber: 7, label: LORE_BLOCKED_LABEL },
      ],
      comments: [
        { repo: REPO, issueNumber: 7, body: expect.stringContaining("merged") },
      ],
      closed: [{ repo: REPO, issueNumber: 7 }],
      ticked: [REPO],
    });
    expect(result).toContain("merged");
  });

  it("cancels the still-open floor run carrying this task's id before settling it", async () => {
    const { deps: d, cancelled } = deps({
      floor: () => ({
        runs: {
          list: async () => ({ items: [run()], nextCursor: null }),
          cancel: async (runId: string, reason: string) => {
            cancelled.push({ runId, reason });

            return run();
          },
        },
      }),
    });

    await settleMergedLoopTicket(d, REPO, BRANCH);

    expect(cancelled).toEqual([{ runId: "run-1", reason: "pr-merged" }]);
  });

  it("leaves other tickets' open runs alone", async () => {
    const otherTaskRun = run({
      startItems: { task_id: { kind: "value", ref: "task-2", by: "lore" } },
    });
    const { deps: d, cancelled } = deps({
      floor: () => ({
        runs: {
          list: async () => ({ items: [otherTaskRun], nextCursor: null }),
          cancel: async (runId: string, reason: string) => {
            cancelled.push({ runId, reason });

            return run();
          },
        },
      }),
    });

    await settleMergedLoopTicket(d, REPO, BRANCH);

    expect(cancelled).toEqual([]);
  });

  it("does nothing for a branch that is not a loop ticket's", async () => {
    const { deps: d, flipped, ticked } = deps();

    const result = await settleMergedLoopTicket(d, REPO, "feature/widgets");

    expect(flipped).toEqual([]);
    expect(ticked).toEqual([]);
    expect(result).toContain("not a loop branch");
  });

  it("does nothing when the issue has no task", async () => {
    const {
      deps: d,
      flipped,
      ticked,
    } = deps({
      tasks: {
        latestLoopTaskByIssue: async () => null,
        setStatusIf: async () => true,
        recordEvent: async () => {},
      },
    });

    const result = await settleMergedLoopTicket(d, REPO, BRANCH);

    expect(flipped).toEqual([]);
    expect(ticked).toEqual([]);
    expect(result).toContain("no task");
  });

  it("does nothing when the task already settled as merged", async () => {
    const {
      deps: d,
      flipped,
      ticked,
    } = deps({
      tasks: {
        latestLoopTaskByIssue: async () => ({ id: "task-1", status: "merged" }),
        setStatusIf: async () => true,
        recordEvent: async () => {},
      },
    });

    const result = await settleMergedLoopTicket(d, REPO, BRANCH);

    expect(flipped).toEqual([]);
    expect(ticked).toEqual([]);
    expect(result).toContain("already settled");
  });

  it.each(["failed", "completed", "running"])(
    "settles a %s task — loop-reap'd, parked at await-pr, or still in flight are exactly what a human merge resolves",
    async (status) => {
      const { deps: d, flipped } = deps({
        tasks: {
          latestLoopTaskByIssue: async () => ({ id: "task-1", status }),
          setStatusIf: async (id, _from, to) => {
            flipped.push({ id, status: to });

            return true;
          },
          recordEvent: async () => {},
        },
      });

      await settleMergedLoopTicket(d, REPO, BRANCH);

      expect(flipped).toEqual([{ id: "task-1", status: "merged" }]);
    },
  );

  it("stops without side effects when another caller already won the status flip", async () => {
    const {
      deps: d,
      events,
      ticked,
    } = deps({
      tasks: {
        latestLoopTaskByIssue: async () => ({ id: "task-1", status: "running" }),
        setStatusIf: async () => false,
        recordEvent: async () => {
          throw new Error("must not record an event when the flip was lost");
        },
      },
    });

    const result = await settleMergedLoopTicket(d, REPO, BRANCH);

    expect(events).toEqual([]);
    expect(ticked).toEqual([]);
    expect(result).toContain("lost the status race");
  });
});
