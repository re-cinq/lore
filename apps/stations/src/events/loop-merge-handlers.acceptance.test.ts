import { describe, expect, it } from "vitest";
import { loopMergeHandlers } from "./loop-merge-handlers.js";

function scene(loopTask: { id: string; status: string } | null) {
  const flipped: Array<{ id: string; status: string }> = [];
  const closedIssues: number[] = [];
  const handlers = loopMergeHandlers({
    settle: {
      floor: () => ({
        runs: {
          list: async () => ({ items: [], nextCursor: null }),
          cancel: async () => {
            return {} as any;
          },
        },
      }),
      tasks: {
        latestLoopTaskByIssue: async () => loopTask,
        setStatusIf: async (id, _from, status) => {
          flipped.push({ id, status });

          return true;
        },
        recordEvent: async () => {},
      },
      comment: async () => {},
      removeLabel: async () => {},
      closeIssue: async (_, issueNumber) => {
        closedIssues.push(issueNumber);
      },
      emitTick: async () => {},
    },
  });
  const close = (params: Record<string, unknown>) =>
    handlers.get("github.pull_request.closed")!(params);

  return { handlers, close, flipped, closedIssues };
}

describe("loopMergeHandlers acceptance", () => {
  it.extend({ spec: "specs/implementation-loop/spec.md#151" })(
    "leaves the issue open when a partial-coverage pull request merges",
    async () => {
      const { close, closedIssues } = scene({
        id: "task-1",
        status: "running",
      });

      await close({
        repo: "acme/widgets",
        branch: "lore/implementation-loop/issue-7",
        merged: true,
        pr_number: 12,
        body: "Refs #7\n\nLore-Task: task-1",
      });

      expect(closedIssues).toEqual([]);
    },
  );
});
