import { describe, it, expect } from "vitest";
import { InMemoryEventReporter } from "@re-cinq/lore-shared/project/events/event-reporter-memory.js";
import type { PlanningRunPort } from "@re-cinq/lore-shared/project/plans/plan-run.js";
import {
  askRefine,
  decideApproval,
  handOverApproved,
  openForAuthor,
  reopenPlan,
  startDrafting,
  type NewPlanningTask,
} from "./planning-line.js";

const PLAN = { id: "p1", repo: "re-cinq/lore", title: "Faster checkout" };
const REFINE = {
  slot: "intent",
  title: "Intent",
  baseHash: "3f9a",
  inputs: {},
  uses: {},
};

const runWith = (visits: object[]): PlanningRunPort => ({
  listForSubject: async () =>
    [
      {
        id: "run-1",
        blueprintName: "feature-planning",
        status: "running",
        outcome: null,
        args: {},
        graph: null,
      },
    ] as never,
  listStationRuns: async () => visits as never,
});

const parkedOnAuthor = runWith([
  { nodeId: "analyze", iteration: 1, outcome: "success" },
  { nodeId: "author", iteration: 1, outcome: null },
]);

const stillDrafting = runWith([
  { nodeId: "analyze", iteration: 1, outcome: null },
]);

const resumes = (reporter: InMemoryEventReporter) =>
  reporter.rows.map((row) => row.params);

describe("startDrafting", () => {
  it("starts gedaiu's feature-planning task on plan p1 of re-cinq/lore with its title for the PR", async () => {
    const created: NewPlanningTask[] = [];

    await startDrafting(
      {
        createTask: async (task) => (created.push(task), "t1"),
        runs: runWith([]),
        reporter: new InMemoryEventReporter(),
      },
      {
        plan: PLAN,
        projection: { title: "Faster checkout" },
        known: "Checkout is slow.",
        createdBy: "gedaiu",
      },
    );

    expect(created).toMatchObject([
      {
        taskType: "feature-planning",
        targetRepo: "re-cinq/lore",
        createdBy: "gedaiu",
        priority: "immediate",
        description: expect.stringContaining("Checkout is slow."),
        contextBundle: {
          plan_id: "p1",
          line_args: { repo: "re-cinq/lore", plan_title: "Faster checkout" },
        },
      },
    ]);
  });
});

describe("startDrafting on a plan whose line waits on its people", () => {
  it("sends the parked author node back to the agent with a fresh draft brief, creating no task", async () => {
    const created: NewPlanningTask[] = [];
    const reporter = new InMemoryEventReporter();

    await startDrafting(
      {
        createTask: async (task) => (created.push(task), "t1"),
        runs: parkedOnAuthor,
        reporter,
      },
      {
        plan: PLAN,
        projection: { title: "Faster checkout" },
        known: "",
        createdBy: "gedaiu",
      },
    );

    expect({ created, resumed: resumes(reporter) }).toMatchObject({
      created: [],
      resumed: [
        {
          assemblyLineId: "run-1",
          nodeId: "author",
          outcome: "changes_requested",
          args: {
            round_feedback: expect.stringContaining(
              'Draft the plan "Faster checkout"',
            ),
            refine: null,
          },
        },
      ],
    });
  });
});

describe("askRefine", () => {
  it("sends the author node back to the agent with the intent section's refine brief", async () => {
    const reporter = new InMemoryEventReporter();

    await askRefine(
      { runs: parkedOnAuthor, reporter },
      PLAN.id,
      { title: "Faster checkout" },
      REFINE,
    );

    expect(resumes(reporter)).toMatchObject([
      {
        assemblyLineId: "run-1",
        nodeId: "author",
        outcome: "changes_requested",
        args: {
          round_feedback: expect.stringContaining(
            'Refine the section "Intent"',
          ),
          refine: { slot: "intent", baseHash: "3f9a", uses: {} },
        },
      },
    ]);
  });

  it("refuses a Refine while the agent is still drafting, resuming nothing", async () => {
    const reporter = new InMemoryEventReporter();

    await expect(
      askRefine(
        { runs: stillDrafting, reporter },
        PLAN.id,
        { title: "Faster checkout" },
        REFINE,
      ),
    ).rejects.toMatchObject({ output: { statusCode: 409 } });
    expect(reporter.rows).toEqual([]);
  });
});

const GRAPH = {
  nodes: [
    { id: "analyze", type: "agent" },
    { id: "author", type: "feature_review" },
    { id: "analyse-specs", type: "agent" },
    { id: "write", type: "agent" },
    { id: "push", type: "agent" },
    { id: "merged", type: "pr_review" },
    { id: "decompose", type: "agent" },
  ],
  edges: [],
  entry: "analyze",
  exit: "decompose",
};

interface LineFacts {
  status: string;
  outcome?: string | null;
  args?: object;
}

const lineWith = (facts: LineFacts, visits: object[]): PlanningRunPort => ({
  listForSubject: async () =>
    [
      {
        id: "run-1",
        blueprintName: "feature-planning",
        status: facts.status,
        outcome: facts.outcome ?? null,
        args: facts.args ?? {},
        graph: GRAPH,
      },
    ] as never,
  listStationRuns: async () => visits as never,
});

const v = (nodeId: string, outcome: string | null, iteration = 1) => ({
  nodeId,
  iteration,
  outcome,
});

const specWorkFailed = lineWith({ status: "failed", outcome: "error" }, [
  v("author", "success"),
  v("analyse-specs", "success"),
  v("write", "success"),
  v("push", "success"),
]);

const specPrOpen = lineWith({ status: "running", args: { pr_number: 7 } }, [
  v("author", "success"),
  v("push", "success"),
  v("merged", null),
]);

const specsMerged = lineWith(
  { status: "finished", outcome: "completed", args: { pr_number: 7 } },
  [v("author", "success"), v("merged", "success"), v("decompose", "success")],
);

const writingSpecs = lineWith({ status: "running" }, [
  v("author", "success"),
  v("analyse-specs", null),
]);

const decomposing = lineWith({ status: "running", args: { pr_number: 7 } }, [
  v("merged", "success"),
  v("decompose", null),
]);

const refining = lineWith({ status: "running" }, [
  v("author", "changes_requested"),
  v("analyze", null, 2),
]);

const specWorkDeps = (runs: PlanningRunPort) => {
  const created: NewPlanningTask[] = [];
  const reporter = new InMemoryEventReporter();

  return {
    created,
    reporter,
    deps: {
      runs,
      reporter,
      createTask: async (task: NewPlanningTask) => (created.push(task), "t2"),
    },
  };
};

describe("decideApproval", () => {
  it("hands the plan over when its line waits on the author", async () => {
    expect(await decideApproval(parkedOnAuthor, "p1")).toEqual({
      kind: "hand-over",
    });
  });

  it("starts the spec work for a plan with no line, one whose spec work failed, and one whose specs merged", async () => {
    expect(
      await Promise.all(
        [runWith([]), specWorkFailed, specsMerged].map((runs) =>
          decideApproval(runs, "p1"),
        ),
      ),
    ).toEqual([
      { kind: "start-spec-work" },
      { kind: "start-spec-work" },
      { kind: "start-spec-work" },
    ]);
  });

  it("refuses while the planning agent is still refining a section, and while the specs are being written", async () => {
    expect(
      await Promise.all(
        [refining, writingSpecs, specPrOpen].map((runs) =>
          decideApproval(runs, "p1"),
        ),
      ),
    ).toEqual([
      {
        kind: "refused",
        reason: "the planning agent is still refining a section",
      },
      { kind: "refused", reason: "the specs are being written" },
      { kind: "refused", reason: "the specs are being written" },
    ]);
  });
});

describe("handOverApproved", () => {
  it("moves the approved plan on to the spec work as its brief", async () => {
    const { deps, created, reporter } = specWorkDeps(parkedOnAuthor);

    await handOverApproved(deps, PLAN, { title: "Faster checkout" }, "gedaiu");

    expect({ created, resumed: resumes(reporter) }).toMatchObject({
      created: [],
      resumed: [
        {
          nodeId: "author",
          outcome: "success",
          args: {
            description: expect.stringContaining(
              'The approved plan "Faster checkout"',
            ),
            round_feedback: null,
            refine: null,
          },
        },
      ],
    });
  });

  it("starts a fresh spec pass at analyse-specs when the plan's spec work failed, resuming nothing", async () => {
    const { deps, created, reporter } = specWorkDeps(specWorkFailed);

    await handOverApproved(deps, PLAN, { title: "Faster checkout" }, "gedaiu");

    expect({ created, resumed: reporter.rows }).toMatchObject({
      resumed: [],
      created: [
        {
          taskType: "feature-planning",
          targetRepo: "re-cinq/lore",
          createdBy: "gedaiu",
          priority: "immediate",
          description: expect.stringContaining(
            'The approved plan "Faster checkout"',
          ),
          contextBundle: {
            plan_id: "p1",
            line_args: {
              repo: "re-cinq/lore",
              plan_title: "Faster checkout",
              entry_node: "analyse-specs",
            },
          },
        },
      ],
    });
  });

  it("briefs the fresh spec pass as a revision of spec PR #7 when the plan's specs already merged", async () => {
    const { deps, created } = specWorkDeps(specsMerged);

    await handOverApproved(deps, PLAN, { title: "Faster checkout" }, "gedaiu");

    expect(created[0]?.description).toContain(
      "The specs on main were written from an earlier version of this plan (spec PR #7)",
    );
  });

  it("hands over nothing while the planning agent is still refining a section", async () => {
    const { deps, created, reporter } = specWorkDeps(refining);

    await handOverApproved(deps, PLAN, { title: "Faster checkout" }, "gedaiu");

    expect({ created, resumed: reporter.rows }).toEqual({
      created: [],
      resumed: [],
    });
  });
});

describe("reopenPlan", () => {
  it("sends the open spec PR back to the author in gedaiu's name", async () => {
    const reporter = new InMemoryEventReporter();

    await reopenPlan({ runs: specPrOpen, reporter }, "p1", "gedaiu");

    expect(resumes(reporter)).toMatchObject([
      {
        assemblyLineId: "run-1",
        nodeId: "merged",
        outcome: "changes_requested",
        args: {
          round_feedback: "gedaiu reopened the plan to revise it",
          refine: null,
        },
      },
    ]);
  });

  it("reports nothing for a plan whose line waits on the author, ended, or never started", async () => {
    const reporter = new InMemoryEventReporter();

    for (const runs of [
      parkedOnAuthor,
      specWorkFailed,
      specsMerged,
      runWith([]),
    ]) {
      await reopenPlan({ runs, reporter }, "p1", "gedaiu");
    }

    expect(reporter.rows).toEqual([]);
  });

  it("refuses while the specs are being written, and while the merged spec is being broken into tasks", async () => {
    const reporter = new InMemoryEventReporter();

    await expect(
      reopenPlan({ runs: writingSpecs, reporter }, "p1", "gedaiu"),
    ).rejects.toMatchObject({
      output: { statusCode: 409 },
      message: "the specs are being written; wait for the spec PR",
    });
    await expect(
      reopenPlan({ runs: decomposing, reporter }, "p1", "gedaiu"),
    ).rejects.toMatchObject({
      output: { statusCode: 409 },
      message: "wait until the spec-tasks are filed",
    });
    expect(reporter.rows).toEqual([]);
  });
});

describe("openForAuthor", () => {
  const questionAsked = lineWith({ status: "running" }, [
    v("author", "success"),
    v("analyse-specs", "changes_requested"),
    v("author", null, 2),
  ]);

  it("reopens approved plan p1 when the spec analysis sent its line back to the author", async () => {
    const reopened: string[] = [];

    const answer = await openForAuthor(
      questionAsked,
      { id: "p1", status: "approved" },
      async (planId) => void reopened.push(planId),
    );

    expect({ answer, reopened }).toEqual({ answer: true, reopened: ["p1"] });
  });

  it("reopens nothing for a draft plan, nor an approved one whose line is not on the author", async () => {
    const reopened: string[] = [];
    const reopen = async (planId: string) => void reopened.push(planId);
    const cases = [
      { runs: parkedOnAuthor, status: "draft" },
      { runs: writingSpecs, status: "approved" },
      { runs: specPrOpen, status: "approved" },
      { runs: specWorkFailed, status: "approved" },
      { runs: runWith([]), status: "approved" },
    ];

    const answers = await Promise.all(
      cases.map(({ runs, status }) =>
        openForAuthor(runs, { id: "p1", status }, reopen),
      ),
    );

    expect({ answers, reopened }).toEqual({
      answers: [false, false, false, false, false],
      reopened: [],
    });
  });
});
