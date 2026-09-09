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
    { id: "dod", type: "agent", station: "agent", station_inherited: true },
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
    {
      id: "retrospective",
      type: "retrospective",
      station: "retrospective",
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

type Row = {
  nodeId: string;
  iteration: number;
  outcome: string | null;
  failureDetail?: string;
};

const walkEndingAtReview = (awaitPrOutcome: string | null): Row[] => [
  { nodeId: "dod", iteration: 1, outcome: "success" },
  { nodeId: "implement", iteration: 1, outcome: "success" },
  { nodeId: "await-pr", iteration: 1, outcome: awaitPrOutcome },
  { nodeId: "retrospective", iteration: 1, outcome: "success" },
];

function deps(rows: Row[] = walkEndingAtReview("success")) {
  const labeled: Array<{ number: number; label: string }> = [];
  const comments: Array<{ number: number; body: string }> = [];
  const ticks: string[] = [];
  const d: LoopRunClosedDeps = {
    getTaskIssueNumber: async () => 7,
    listStationRuns: async () => rows,
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
    const { d, labeled, comments, ticks } = deps(walkEndingAtReview("success"));

    await handleLoopRunClosed(run(), "completed", undefined, d);

    expect(ticks).toEqual(["acme/widgets"]);
    expect(labeled).toEqual([]);
    expect(comments).toEqual([]);
  });

  it("blocks a ticket the definition-of-done step could not express, quoting its reason on the issue", async () => {
    const { d, labeled, comments } = deps([
      {
        nodeId: "dod",
        iteration: 1,
        outcome: "changes_requested",
        failureDetail: "the ticket asks for a decision, not a behaviour",
      },
      { nodeId: "retrospective", iteration: 1, outcome: "success" },
    ]);

    await handleLoopRunClosed(run(), "completed", undefined, d);

    expect(labeled).toEqual([{ number: 7, label: "lore:blocked" }]);
    expect(comments).toEqual([
      {
        number: 7,
        body: expect.stringContaining(
          "the ticket asks for a decision, not a behaviour",
        ),
      },
    ]);
  });

  it("asks the author for a claim that can be stated as a failing test when the definition of done declined the ticket", async () => {
    const { d, comments } = deps([
      { nodeId: "dod", iteration: 1, outcome: "changes_requested" },
      { nodeId: "retrospective", iteration: 1, outcome: "success" },
    ]);

    await handleLoopRunClosed(run(), "completed", undefined, d);

    expect(comments[0]?.body).toContain("fails today");
  });

  it("blocks a ticket whose round reported it was stuck", async () => {
    const { d, labeled, comments } = deps([
      { nodeId: "dod", iteration: 1, outcome: "success" },
      {
        nodeId: "implement",
        iteration: 1,
        outcome: "failed",
        failureDetail: "no facet expressible as a test",
      },
      { nodeId: "retrospective", iteration: 1, outcome: "success" },
    ]);

    await handleLoopRunClosed(run(), "completed", undefined, d);

    expect(labeled).toEqual([{ number: 7, label: "lore:blocked" }]);
    expect(comments[0]?.body).toContain("no facet expressible as a test");
  });

  it("labels lore:blocked and comments when await-pr resumed failed", async () => {
    const { d, labeled, comments, ticks } = deps(walkEndingAtReview("failed"));

    await handleLoopRunClosed(run(), "completed", undefined, d);

    expect(labeled).toEqual([{ number: 7, label: "lore:blocked" }]);
    expect(comments).toHaveLength(1);
    expect(comments[0]?.body).toContain("https://gh/pr/12");
    expect(ticks).toEqual(["acme/widgets"]);
  });

  it("blocks a ticket whose build stayed red after the repair attempts", async () => {
    const { d, labeled, comments, ticks } = deps(
      walkEndingAtReview("changes_requested"),
    );

    await handleLoopRunClosed(run(), "completed", undefined, d);

    expect(labeled).toEqual([{ number: 7, label: "lore:blocked" }]);
    expect(comments[0]?.body).toContain("stayed red");
    expect(ticks).toEqual(["acme/widgets"]);
  });

  it("labels lore:blocked when the run itself failed", async () => {
    const { d, labeled, ticks } = deps(walkEndingAtReview(null));

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
    const { d, ticks } = deps(walkEndingAtReview("changes_requested"));

    d.addLabel = async () => {
      throw new Error("403");
    };
    await handleLoopRunClosed(run(), "completed", undefined, d);

    expect(ticks).toEqual(["acme/widgets"]);
  });
});
