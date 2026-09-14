import { describe, expect, it } from "vitest";
import {
  handleLoopRunClosed,
  type LoopRunClosedDeps,
} from "./loop-run-closed.js";
import {
  countInfraFailures,
  infraDeferralsFromEnv,
} from "./loop-infra-deferral.js";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";

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
  branch: "lore/implementation-loop/issue-7",
  args: { pr_url: "https://gh/pr/12" },
  graph,
  ...over,
});

type Row = {
  nodeId: string;
  iteration: number;
  outcome: string | null;
  failureDetail?: string;
  failureClass?: string;
};

const walkEndingAtReview = (awaitPrOutcome: string | null): Row[] => [
  { nodeId: "dod", iteration: 1, outcome: "success" },
  { nodeId: "implement", iteration: 1, outcome: "success" },
  { nodeId: "await-pr", iteration: 1, outcome: awaitPrOutcome },
  { nodeId: "retrospective", iteration: 1, outcome: "success" },
];

function deps(
  rows: Row[] = walkEndingAtReview("success"),
  priorInfraFailures = 0,
) {
  const labeled: Array<{ number: number; label: string }> = [];
  const comments: Array<{ number: number; body: string }> = [];
  const ticks: string[] = [];
  const closedIssues: number[] = [];
  const closedPrs: number[] = [];
  const d: LoopRunClosedDeps = {
    getTaskIssueNumber: async () => 7,
    listStationRuns: async () => rows,
    priorInfraFailures: async () => priorInfraFailures,
    maxInfraDeferrals: 3,
    addLabel: async (_repo, number, label) => {
      labeled.push({ number, label });
    },
    comment: async (_repo, number, body) => {
      comments.push({ number, body });
    },
    closeIssue: async (_repo, number) => {
      closedIssues.push(number);
    },
    closePr: async (_repo, number) => {
      closedPrs.push(number);
    },
    emitTick: async (repo) => {
      ticks.push(repo);
    },
  };

  return { d, labeled, comments, ticks, closedIssues, closedPrs };
}

const resolvedWalk: Row[] = [
  {
    nodeId: "dod",
    iteration: 1,
    outcome: "changes_requested",
    failureDetail: "already resolved: fixed on main by #2064",
  },
  { nodeId: "retrospective", iteration: 1, outcome: "success" },
];

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

  it("closes a ticket the definition-of-done step found already resolved, quoting why, and closes its pull request instead of parking", async () => {
    const { d, labeled, comments, closedIssues, closedPrs } =
      deps(resolvedWalk);

    await handleLoopRunClosed(
      run({ args: { pr_url: "https://gh/pr/12", pr_number: 12 } }),
      "completed",
      undefined,
      d,
    );

    expect(labeled).toEqual([]);
    expect(comments).toEqual([
      {
        number: 7,
        body: expect.stringContaining("fixed on main by #2064"),
      },
    ]);
    expect(closedIssues).toEqual([7]);
    expect(closedPrs).toEqual([12]);
  });

  it("closes only the issue when the resolved ticket's run opened no pull request", async () => {
    const { d, closedIssues, closedPrs } = deps(resolvedWalk);

    await handleLoopRunClosed(run({ args: {} }), "completed", undefined, d);

    expect(closedIssues).toEqual([7]);
    expect(closedPrs).toEqual([]);
  });

  it("asks the author for a claim that can be stated as a failing test when the definition of done declined the ticket", async () => {
    const { d, comments } = deps([
      { nodeId: "dod", iteration: 1, outcome: "changes_requested" },
      { nodeId: "retrospective", iteration: 1, outcome: "success" },
    ]);

    await handleLoopRunClosed(run(), "completed", undefined, d);

    expect(comments[0]?.body).toContain("fails today");
  });

  it("does not ask for a rewrite when the definition of done crashed rather than declined the ticket", async () => {
    const { d, comments } = deps([
      { nodeId: "dod", iteration: 1, outcome: "failed" },
      { nodeId: "retrospective", iteration: 1, outcome: "success" },
    ]);

    await handleLoopRunClosed(run(), "completed", undefined, d);

    expect(comments[0]?.body).not.toContain("fails today");
  });

  it("does not mistake an agent node merely named after the review type for the review node", async () => {
    const graphWithoutAReviewType = {
      ...graph,
      nodes: graph.nodes.map((n) =>
        n.id === "await-pr" ? { ...n, id: "pr_review", type: "agent" } : n,
      ),
    };
    const { d, comments } = deps([
      { nodeId: "dod", iteration: 1, outcome: "success" },
      { nodeId: "implement", iteration: 1, outcome: "success" },
      { nodeId: "pr_review", iteration: 1, outcome: "failed" },
      { nodeId: "retrospective", iteration: 1, outcome: "success" },
    ]);

    await handleLoopRunClosed(
      run({ graph: graphWithoutAReviewType }),
      "completed",
      undefined,
      d,
    );

    expect(comments[0]?.body).toContain("the `pr_review` step reported");
    expect(comments[0]?.body).not.toContain("review threads");
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

  it("defers a ticket whose run no cluster-agent claimed: no label, a comment naming the attempt, and the re-arm", async () => {
    const { d, labeled, comments, ticks } = deps([
      {
        nodeId: "dod",
        iteration: 1,
        outcome: "failed",
        failureClass: "unclaimed",
        failureDetail: "no cluster-agent claimed this run within 30m",
      },
    ]);

    await handleLoopRunClosed(
      run(),
      "failed",
      "no cluster-agent claimed this run (required_tags: [node:agent]) within 30m",
      d,
    );

    expect(labeled).toEqual([]);
    expect(comments[0]?.body).toContain(
      "deferring this ticket, not parking it (infrastructure attempt 1 of 3)",
    );
    expect(ticks).toEqual(["acme/widgets"]);
  });

  it("parks the ticket on the third infrastructure failure within a day, naming the count", async () => {
    const { d, labeled, comments } = deps(
      [
        {
          nodeId: "dod",
          iteration: 1,
          outcome: "failed",
          failureClass: "infra",
        },
      ],
      2,
    );

    await handleLoopRunClosed(run(), "failed", "pod died", d);

    expect(labeled).toEqual([{ number: 7, label: "lore:blocked" }]);
    expect(comments[0]?.body).toContain(
      "infrastructure failure 3 of 3 on this ticket within a day, so the loop stops deferring it",
    );
  });

  it("parks, never defers, a run that failed on the work rather than on the cluster", async () => {
    const { d, labeled } = deps([
      { nodeId: "dod", iteration: 1, outcome: "failed", failureClass: "auth" },
    ]);

    await handleLoopRunClosed(run(), "failed", "Authentication failed", d);

    expect(labeled).toEqual([{ number: 7, label: "lore:blocked" }]);
  });

  it("counts the branch's earlier infrastructure failures without the run that just closed, which is already failed in the table", async () => {
    const port = new InMemoryAssemblyRuns();
    const branch = "lore/implementation-loop/issue-7";
    const failUnclaimed = async (id: string) => {
      const { nodeRowId } = await port.ensureStationRun({
        assemblyRunId: id,
        nodeId: "dod",
        iteration: 1,
      });

      await port.finishStationRunOnce(nodeRowId, "failed", undefined, {
        failureClass: "unclaimed",
      });
      await port.finish(id, "failed", "no cluster-agent claimed this run");
    };
    const earlier = await port.start({
      blueprintName: "implementation-loop",
      repo: "acme/widgets",
      branch,
    });
    const current = await port.start({
      blueprintName: "implementation-loop",
      repo: "acme/widgets",
      branch,
    });

    await failUnclaimed(earlier);
    await failUnclaimed(current);

    expect(
      await countInfraFailures(port, {
        repo: "acme/widgets",
        branch,
        since: new Date(0),
        excludeRunId: current,
      }),
    ).toBe(1);
  });

  it("reads the deferral bound from LORE_LOOP_INFRA_DEFERRALS and falls back to 3", () => {
    expect(infraDeferralsFromEnv({ LORE_LOOP_INFRA_DEFERRALS: "5" })).toBe(5);
    expect(infraDeferralsFromEnv({ LORE_LOOP_INFRA_DEFERRALS: "lots" })).toBe(
      3,
    );
    expect(infraDeferralsFromEnv({})).toBe(3);
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
