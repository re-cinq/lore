import { describe, expect, it } from "vitest";
import {
  handleLoopRunClosed,
  type LoopRunClosedDeps,
} from "./loop-run-closed.js";

const graph = {
  name: "implementation-loop",
  entry: "implement",
  exit: "done",
  nodes: [
    {
      id: "implement",
      type: "agent",
      station: "agent",
      station_inherited: true,
    },
    {
      id: "await-pr",
      type: "pr_review",
      station: "pr-review",
      station_inherited: true,
    },
  ],
  edges: [],
};

const run = (
  over: Partial<Parameters<typeof handleLoopRunClosed>[0]> = {},
) => ({
  id: "run-1",
  repo: "acme/widgets",
  blueprintName: "implementation-loop",
  taskId: "task-1",
  args: { pr_url: "https://gh/pr/12" },
  graph,
  ...over,
});

function deps(awaitPrOutcome: string | null = "success") {
  const labeled: Array<{ number: number; label: string }> = [];
  const comments: Array<{ number: number; body: string }> = [];
  const ticks: string[] = [];
  const d: LoopRunClosedDeps = {
    getTaskIssueNumber: async () => 7,
    listStationRuns: async () => [
      { nodeId: "implement", iteration: 1, outcome: "success" },
      { nodeId: "await-pr", iteration: 1, outcome: awaitPrOutcome },
    ],
    addLabel: async (_repo, number, label) => {
      labeled.push({ number, label });
    },
    comment: async (_repo, number, body) => {
      comments.push({ number, body });
    },
    emitTick: async (repo) => {
      ticks.push(repo);
    },
  };

  return { d, labeled, comments, ticks };
}

describe("handleLoopRunClosed", () => {
  it("re-arms the repo after a completed ticket without touching the issue", async () => {
    const { d, labeled, comments, ticks } = deps("success");

    await handleLoopRunClosed(run(), "completed", undefined, d);

    expect(ticks).toEqual(["acme/widgets"]);
    expect(labeled).toEqual([]);
    expect(comments).toEqual([]);
  });

  it("labels lore:blocked and comments when await-pr resumed failed", async () => {
    // `failed` on the wait = review threads the address round-trip did not
    // clear. That is the terminal one a human owns.
    const { d, labeled, comments, ticks } = deps("failed");

    await handleLoopRunClosed(run(), "completed", undefined, d);

    expect(labeled).toEqual([{ number: 7, label: "lore:blocked" }]);
    expect(comments).toHaveLength(1);
    expect(comments[0]?.body).toContain("https://gh/pr/12");
    expect(ticks).toEqual(["acme/widgets"]);
  });

  it("blocks a ticket whose build stayed red after the repair attempts", async () => {
    // A repaired build never closes the run here — fix-ci success routes back
    // to the wait and parks it again. So a CLOSED run whose last wait resumed
    // changes_requested is one where fix-ci gave up, and letting it re-arm
    // would reset the fix budget and cycle the ticket across runs forever.
    const { d, labeled, comments, ticks } = deps("changes_requested");

    await handleLoopRunClosed(run(), "completed", undefined, d);

    expect(labeled).toEqual([{ number: 7, label: "lore:blocked" }]);
    expect(comments[0]?.body).toContain("stayed red");
    expect(ticks).toEqual(["acme/widgets"]);
  });

  it("labels lore:blocked when the run itself failed", async () => {
    const { d, labeled, ticks } = deps(null);

    await handleLoopRunClosed(run(), "failed", "iteration_max", d);

    expect(labeled).toEqual([{ number: 7, label: "lore:blocked" }]);
    expect(ticks).toEqual(["acme/widgets"]);
  });

  it("ignores a run of any other blueprint", async () => {
    const { d, ticks } = deps();

    await handleLoopRunClosed(
      run({ blueprintName: "code-review" }),
      "completed",
      undefined,
      d,
    );

    expect(ticks).toEqual([]);
  });

  it("still re-arms when the issue write fails", async () => {
    const { d, ticks } = deps("changes_requested");

    d.addLabel = async () => {
      throw new Error("403");
    };
    await handleLoopRunClosed(run(), "completed", undefined, d);

    expect(ticks).toEqual(["acme/widgets"]);
  });
});
