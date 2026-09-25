import { describe, it, expect } from "vitest";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import { InMemoryEventReporter } from "@re-cinq/lore-shared/project/events/event-reporter-memory.js";
import type { RunGraph } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import type { PlanLine } from "@re-cinq/lore-shared/project/plans/plan-run.js";
import { startPlanValidation } from "./plan-validate.js";

const PLAN = { id: "p1", status: "draft" };

const GRAPH: RunGraph = {
  name: "feature-planning",
  entry: "analyse-specs",
  exit: "done",
  nodes: [
    { id: "validate", type: "agent", station: "s", station_inherited: false },
    { id: "author", type: "pr_review", station: "s", station_inherited: false },
    { id: "done", type: "retrospective", station: "s", station_inherited: false },
  ],
  edges: [{ from: "validate", to: "author" }],
};

async function visiting(runs: InMemoryAssemblyRuns, nodeId: string) {
  const id = await runs.start({
    blueprintName: "feature-planning",
    repo: "re-cinq/lore",
    branch: "lore/feature-planning/faster-checkout-abcd1234",
    subjectKey: "plan:p1",
    args: {},
  });

  await runs.markRunning(id);
  await runs.stampBlueprint(id, "hash", GRAPH);
  await runs.ensureStationRun({
    assemblyRunId: id,
    nodeId,
    iteration: 1,
  });

  return id;
}

function line(lineId: string, facts: Partial<PlanLine> = {}): PlanLine {
  return {
    lineId,
    status: "running",
    outcome: null,
    prNumber: null,
    prUrl: null,
    branch: "lore/feature-planning/faster-checkout-abcd1234",
    open: "author",
    parkedAuthor: { lineId, nodeId: "author", iteration: 1 },
    parkedMerged: null,
    merged: false,
    ...facts,
  };
}

function subject() {
  const runs = new InMemoryAssemblyRuns();
  const reporter = new InMemoryEventReporter();

  return {
    runs,
    reporter,
    deps: {
      station: {
        runs,
        reporter,
        graphOf: async () => GRAPH,
        humanStationIds: () => new Set(["author"]),
      },
    },
  };
}

describe("startPlanValidation", () => {
  it("runs the validate station on the parked line, naming gedaiu", async () => {
    const { runs, reporter, deps } = subject();
    const id = await visiting(runs, "author");

    const result = await startPlanValidation(deps, {
      plan: PLAN,
      line: line(id),
      actor: "gedaiu",
    });

    expect({
      result,
      events: reporter.rows.map((row) => row.params),
    }).toEqual({
      result: { run_id: id },
      events: [
        {
          assemblyRunId: id,
          nodeId: "validate",
          actor: "gedaiu",
          repo: "re-cinq/lore",
        },
      ],
    });
  });

  it("refuses with 409 while the planning agent is still on validate and nothing is parked on author", async () => {
    const { runs, deps } = subject();
    const id = await visiting(runs, "validate");

    await expect(
      startPlanValidation(deps, {
        plan: PLAN,
        line: line(id, { open: "validate", parkedAuthor: null }),
        actor: "gedaiu",
      }),
    ).rejects.toMatchObject({
      output: { statusCode: 409 },
      message:
        "the planning agent is still working; validate once it hands the plan back",
    });
  });

  it("refuses with 409 a plan that has no planning line yet", async () => {
    const { deps } = subject();

    await expect(
      startPlanValidation(deps, { plan: PLAN, line: null, actor: "gedaiu" }),
    ).rejects.toMatchObject({
      output: { statusCode: 409 },
      message: "the plan has no planning line yet",
    });
  });

  it("refuses with 409 a plan that is already approved", async () => {
    const { runs, deps } = subject();
    const id = await visiting(runs, "author");

    await expect(
      startPlanValidation(deps, {
        plan: { id: "p1", status: "approved" },
        line: line(id),
        actor: "gedaiu",
      }),
    ).rejects.toMatchObject({
      output: { statusCode: 409 },
      message: "the plan is approved; validation runs before approval",
    });
  });
});
