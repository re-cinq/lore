import { describe, it, expect } from "vitest";
import { InMemoryEventReporter } from "@re-cinq/lore-shared/project/events/event-reporter-memory.js";
import type { PlanningRunPort } from "@re-cinq/lore-shared/project/plans/plan-run.js";
import {
  askRefine,
  handOverApproved,
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
      { createTask: async (task) => (created.push(task), "t1") },
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
            "Refine only the section intent",
          ),
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

describe("handOverApproved", () => {
  it("moves the approved plan on to the spec work as its brief", async () => {
    const reporter = new InMemoryEventReporter();

    await handOverApproved({ runs: parkedOnAuthor, reporter }, PLAN.id, {
      title: "Faster checkout",
    });

    expect(resumes(reporter)).toMatchObject([
      {
        nodeId: "author",
        outcome: "success",
        args: {
          description: expect.stringContaining(
            'The approved plan "Faster checkout"',
          ),
          round_feedback: null,
        },
      },
    ]);
  });

  it("hands over nothing for a plan whose line is not waiting on its people", async () => {
    const reporter = new InMemoryEventReporter();

    await handOverApproved({ runs: stillDrafting, reporter }, PLAN.id, {
      title: "Faster checkout",
    });

    expect(reporter.rows).toEqual([]);
  });
});
