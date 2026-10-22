import { describe, expect, it } from "vitest";
import { LOOP_MERGE_EVENTS, loopMergeHandlers } from "./loop-merge-handlers.js";

function scene(activeTask: { id: string; status: string } | null) {
  const flipped: Array<{ id: string; status: string }> = [];
  const handlers = loopMergeHandlers({
    settle: {
      floor: () => ({
        runs: {
          list: async () => ({ items: [], nextCursor: null }),
          cancel: async () => {
            throw new Error("not exercised here");
          },
        },
      }),
      tasks: {
        activeTaskByIssue: async () => activeTask,
        setStatusIf: async (id, _from, status) => {
          flipped.push({ id, status });

          return true;
        },
        recordEvent: async () => {},
      },
      comment: async () => {},
      removeLabel: async () => {},
      closeIssue: async () => {},
      emitTick: async () => {},
    },
  });
  const close = (params: Record<string, unknown>) =>
    handlers.get("github.pull_request.closed")!(params);

  return { handlers, close, flipped };
}

describe("loopMergeHandlers", () => {
  it("answers github.pull_request.closed, the one event it asks the bus for", () => {
    const { handlers } = scene(null);

    expect([...handlers.keys()]).toEqual([...LOOP_MERGE_EVENTS]);
  });

  it("settles issue 7's active task when PR 12 merges on its loop branch", async () => {
    const { close, flipped } = scene({ id: "task-1", status: "running" });

    await close({
      repo: "acme/widgets",
      branch: "lore/implementation-loop/issue-7",
      merged: true,
      pr_number: 12,
    });

    expect(flipped).toEqual([{ id: "task-1", status: "merged" }]);
  });

  it("does nothing for a pull request closed without merging", async () => {
    const { close, flipped } = scene({ id: "task-1", status: "running" });

    await close({
      repo: "acme/widgets",
      branch: "lore/implementation-loop/issue-7",
      merged: false,
    });

    expect(flipped).toEqual([]);
  });

  it("does nothing for a branch that is not a loop ticket's", async () => {
    const { close, flipped } = scene({ id: "task-1", status: "running" });

    await close({
      repo: "acme/widgets",
      branch: "feature/widgets",
      merged: true,
    });

    expect(flipped).toEqual([]);
  });
});
