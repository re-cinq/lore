import { describe, expect, it } from "vitest";
import { mapGitHubEvent } from "@re-cinq/lore-shared/project/events/github-map.js";
import { loopMergeHandlers } from "./loop-merge-handlers.js";

function scene(loopTask: { id: string; status: string } | null) {
  const flipped: Array<{ id: string; status: string }> = [];
  const labelsRemoved: Array<{ issueNumber: number; label: string }> = [];
  const comments: Array<{ issueNumber: number; body: string }> = [];
  const closedIssues: number[] = [];
  const ticked: string[] = [];
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
        latestLoopTaskByIssue: async () => loopTask,
        setStatusIf: async (id, _from, status) => {
          flipped.push({ id, status });

          return true;
        },
        recordEvent: async () => {},
      },
      comment: async (_repo, issueNumber, body) => {
        comments.push({ issueNumber, body });
      },
      removeLabel: async (_repo, issueNumber, label) => {
        labelsRemoved.push({ issueNumber, label });
      },
      closeIssue: async (_repo, issueNumber) => {
        closedIssues.push(issueNumber);
      },
      emitTick: async (repo) => {
        ticked.push(repo);
      },
    },
  });
  const close = (params: Record<string, unknown>) =>
    handlers.get("github.pull_request.closed")!(params);

  return {
    handlers,
    close,
    flipped,
    labelsRemoved,
    comments,
    closedIssues,
    ticked,
  };
}

describe("loopMergeHandlers acceptance", () => {
  it.extend({ spec: "specs/implementation-loop/spec.md#151" })(
    "leaves the issue open when a partial-coverage pull request merges",
    async () => {
      const { close, flipped, labelsRemoved, comments, closedIssues, ticked } =
        scene({
          id: "task-1",
          status: "running",
        });
      const [event] = mapGitHubEvent(
        "pull_request",
        {
          repository: { full_name: "acme/widgets" },
          action: "closed",
          pull_request: {
            number: 12,
            merged: true,
            head: { ref: "lore/implementation-loop/issue-7" },
            base: { ref: "main" },
            body: "Refs #7\n\nLore-Task: task-1",
          },
        },
        "d-1",
      );

      await close(event.params ?? {});

      expect({
        flipped,
        labelsRemoved,
        comments,
        closedIssues,
        ticked,
      }).toEqual({
        flipped: [{ id: "task-1", status: "merged" }],
        labelsRemoved: [],
        comments: [],
        closedIssues: [],
        ticked: ["acme/widgets"],
      });
    },
  );
});
