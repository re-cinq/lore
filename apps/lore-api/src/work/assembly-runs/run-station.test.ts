import { describe, it, expect } from "vitest";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import type { RunGraph } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import { runStation } from "./run-station.js";

const GRAPH: RunGraph = {
  name: "feature-planning",
  entry: "analyze",
  exit: "done",
  nodes: [
    { id: "analyze", type: "agent", station: "s", station_inherited: false },
    {
      id: "author",
      type: "feature_review",
      station: "s",
      station_inherited: false,
    },
    { id: "write", type: "agent", station: "s", station_inherited: false },
    {
      id: "done",
      type: "retrospective",
      station: "s",
      station_inherited: false,
    },
  ],
  edges: [],
};

const graphOf = async () => GRAPH;

async function parkedLine(runs: InMemoryAssemblyRuns) {
  const id = await runs.start({
    blueprintName: "feature-planning",
    repo: "re-cinq/lore",
    branch: "lore/feature-planning/kpis",
    taskId: "task-1",
    subjectKey: "plan:p1",
    args: { plan_id: "p1", spec_path: "specs/kpi/spec.md" },
  });

  await runs.markRunning(id);

  return id;
}

describe("runStation", () => {
  it("retires the parked line in gedaiu's name and starts a fresh one on the same work, entered at write", async () => {
    const runs = new InMemoryAssemblyRuns();
    const source = await parkedLine(runs);

    const fresh = await runStation(runs, graphOf, {
      runId: source,
      nodeId: "write",
      actor: "gedaiu",
    });

    expect({
      retired: await runs.getById(source),
      fresh: await runs.getById(fresh),
    }).toMatchObject({
      retired: {
        status: "finished",
        outcome: "cancelled",
        reason:
          "gedaiu ran the write station by hand; a fresh line took over this work",
      },
      fresh: {
        blueprintName: "feature-planning",
        repo: "re-cinq/lore",
        branch: "lore/feature-planning/kpis",
        taskId: "task-1",
        subjectKey: "plan:p1",
        status: "queued",
        args: {
          plan_id: "p1",
          spec_path: "specs/kpi/spec.md",
          entry_node: "write",
          run_station_by: "gedaiu",
          run_station_from: source,
        },
      },
    });
  });

  it("leaves a line that already ended as it is and still starts the fresh one", async () => {
    const runs = new InMemoryAssemblyRuns();
    const source = await parkedLine(runs);

    await runs.finish(source, "error", "push pushed nothing");
    const fresh = await runStation(runs, graphOf, {
      runId: source,
      nodeId: "write",
      actor: "gedaiu",
    });

    expect({
      source: (await runs.getById(source))?.reason,
      fresh: (await runs.getById(fresh))?.args.entry_node,
    }).toEqual({ source: "push pushed nothing", fresh: "write" });
  });

  it("refuses a node the run's graph does not have, retiring nothing", async () => {
    const runs = new InMemoryAssemblyRuns();
    const source = await parkedLine(runs);

    await expect(
      runStation(runs, graphOf, {
        runId: source,
        nodeId: "nope",
        actor: "gedaiu",
      }),
    ).rejects.toMatchObject({
      output: { statusCode: 400 },
      message: '"nope" is not a station of feature-planning',
    });
    expect((await runs.getById(source))?.status).toBe("running");
  });

  it("refuses when another open line already works the subject, naming it", async () => {
    const runs = new InMemoryAssemblyRuns();
    const source = await parkedLine(runs);

    await runs.finish(source, "error", "died");
    const holder = await runs.start({
      blueprintName: "feature-planning",
      repo: "re-cinq/lore",
      subjectKey: "plan:p1",
    });

    await expect(
      runStation(runs, graphOf, {
        runId: source,
        nodeId: "write",
        actor: "gedaiu",
      }),
    ).rejects.toMatchObject({
      output: { statusCode: 409 },
      message: `another run (${holder}) is already working plan:p1; wait for it or cancel it first`,
    });
  });

  it("answers 404 for a run that does not exist", async () => {
    await expect(
      runStation(new InMemoryAssemblyRuns(), graphOf, {
        runId: "nope",
        nodeId: "write",
        actor: "gedaiu",
      }),
    ).rejects.toMatchObject({ output: { statusCode: 404 } });
  });
});
