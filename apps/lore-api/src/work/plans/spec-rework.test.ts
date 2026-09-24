import { describe, it, expect } from "vitest";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import { InMemoryEventReporter } from "@re-cinq/lore-shared/project/events/event-reporter-memory.js";
import type { RunGraph } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import type { PlanLine } from "@re-cinq/lore-shared/project/plans/plan-run.js";
import { startSpecRework, type SpecReviewReads } from "./spec-rework.js";

const PLAN = { id: "p1", status: "approved" };

const GRAPH: RunGraph = {
  name: "feature-planning",
  entry: "analyse-specs",
  exit: "done",
  nodes: [
    { id: "write", type: "agent", station: "s", station_inherited: false },
    { id: "push", type: "agent", station: "s", station_inherited: false },
    {
      id: "merged",
      type: "pr_review",
      station: "s",
      station_inherited: false,
    },
    {
      id: "done",
      type: "retrospective",
      station: "s",
      station_inherited: false,
    },
  ],
  edges: [],
};

const THREADS = [
  {
    id: "T_1",
    isResolved: false,
    isOutdated: false,
    comments: [{ databaseId: 41 }],
  },
  {
    id: "T_2",
    isResolved: true,
    isOutdated: false,
    comments: [{ databaseId: 42 }],
  },
];

const COMMENTS = [
  {
    id: 41,
    path: "specs/checkout/spec.md",
    line: 12,
    user: "ana",
    body: "FR2 contradicts the plan",
  },
  {
    id: 42,
    path: "specs/checkout/spec.md",
    line: 30,
    user: "ana",
    body: "typo",
  },
];

const REVIEWS = [
  { id: 9, state: "CHANGES_REQUESTED", body: "Split FR3.", user: "ana" },
  { id: 10, state: "APPROVED", body: "", user: "bob" },
];

const withReview = (reads: Partial<SpecReviewReads> = {}): SpecReviewReads => ({
  listReviewThreads: async () => THREADS as never,
  listComments: async () => COMMENTS as never,
  listReviews: async () => REVIEWS as never,
  ...reads,
});

async function parkedOnMerged(runs: InMemoryAssemblyRuns, args: object) {
  const id = await runs.start({
    blueprintName: "feature-planning",
    repo: "re-cinq/lore",
    branch: "lore/feature-planning/faster-checkout-abcd1234",
    subjectKey: "plan:p1",
    args: args as Record<string, unknown>,
  });

  await runs.markRunning(id);
  await runs.stampBlueprint(id, "hash", GRAPH);
  await runs.ensureStationRun({
    assemblyRunId: id,
    nodeId: "merged",
    iteration: 1,
  });

  return id;
}

function line(lineId: string, facts: Partial<PlanLine> = {}): PlanLine {
  return {
    lineId,
    status: "running",
    outcome: null,
    prNumber: 7,
    prUrl: "https://github.com/re-cinq/lore/pull/7",
    branch: "lore/feature-planning/faster-checkout-abcd1234",
    open: "merged",
    parkedAuthor: null,
    parkedMerged: { lineId, nodeId: "merged", iteration: 1 },
    merged: false,
    ...facts,
  };
}

function subject(pulls: SpecReviewReads = withReview()) {
  const runs = new InMemoryAssemblyRuns();
  const reporter = new InMemoryEventReporter();

  return {
    runs,
    reporter,
    deps: {
      runs,
      pulls,
      station: {
        runs,
        reporter,
        graphOf: async () => GRAPH,
        humanStationIds: () => new Set(["merged"]),
      },
    },
  };
}

describe("startSpecRework", () => {
  it("stores spec PR #7's unresolved review on the run's args and asks the Floor to run write again, naming gedaiu", async () => {
    const { runs, reporter, deps } = subject();
    const id = await parkedOnMerged(runs, { spec_review_reopen: true });

    const answered = await startSpecRework(deps, {
      plan: PLAN,
      line: line(id),
      actor: "gedaiu",
    });

    expect({
      answered,
      args: (await runs.getById(id))?.args,
      events: reporter.rows.map((row) => row.params),
    }).toEqual({
      answered: id,
      args: {
        spec_review: JSON.stringify({
          pr_number: 7,
          reviews: [
            {
              id: 9,
              author: "ana",
              state: "CHANGES_REQUESTED",
              body: "Split FR3.",
            },
          ],
          comments: [
            {
              id: 41,
              path: "specs/checkout/spec.md",
              line: 12,
              author: "ana",
              body: "FR2 contradicts the plan",
            },
          ],
        }),
        spec_review_reopen: null,
      },
      events: [
        {
          assemblyRunId: id,
          nodeId: "write",
          actor: "gedaiu",
          repo: "re-cinq/lore",
        },
      ],
    });
  });

  it("refuses with 409 while the spec PR is not waiting for review, storing and asking nothing", async () => {
    const { runs, reporter, deps } = subject();
    const id = await parkedOnMerged(runs, {});

    await expect(
      startSpecRework(deps, {
        plan: PLAN,
        line: line(id, { open: "push", parkedMerged: null }),
        actor: "gedaiu",
      }),
    ).rejects.toMatchObject({
      output: { statusCode: 409 },
      message: "the spec PR is not waiting for review",
    });
    expect({
      args: (await runs.getById(id))?.args,
      events: reporter.rows,
    }).toEqual({
      args: {},
      events: [],
    });
  });

  it("refuses with 409 a line that has no spec PR", async () => {
    const { runs, deps } = subject();
    const id = await parkedOnMerged(runs, {});

    await expect(
      startSpecRework(deps, {
        plan: PLAN,
        line: line(id, { prNumber: null, prUrl: null }),
        actor: "gedaiu",
      }),
    ).rejects.toMatchObject({
      output: { statusCode: 409 },
      message: "the line has no spec PR",
    });
  });

  it("refuses with 409 when every thread is resolved and no review said anything, asking nothing", async () => {
    const { runs, reporter, deps } = subject(
      withReview({
        listReviewThreads: async () => [],
        listReviews: async () =>
          [{ id: 10, state: "APPROVED", body: "  ", user: "bob" }] as never,
      }),
    );
    const id = await parkedOnMerged(runs, {});

    await expect(
      startSpecRework(deps, { plan: PLAN, line: line(id), actor: "gedaiu" }),
    ).rejects.toMatchObject({
      output: { statusCode: 409 },
      message:
        "nothing on the spec PR is waiting for the writer: no unresolved comment and no review body",
    });
    expect(reporter.rows).toEqual([]);
  });

  it("refuses with 409 a plan that is not approved", async () => {
    const { runs, deps } = subject();
    const id = await parkedOnMerged(runs, {});

    await expect(
      startSpecRework(deps, {
        plan: { id: "p1", status: "draft" },
        line: line(id),
        actor: "gedaiu",
      }),
    ).rejects.toMatchObject({
      output: { statusCode: 409 },
      message: "the plan is not approved",
    });
  });
});
