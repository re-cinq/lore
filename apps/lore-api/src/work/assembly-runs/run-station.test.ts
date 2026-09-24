import { describe, it, expect } from "vitest";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import { InMemoryEventReporter } from "@re-cinq/lore-shared/project/events/event-reporter-memory.js";
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

async function lineWith(
  runs: InMemoryAssemblyRuns,
  open: { nodeId: string } | null,
) {
  const id = await runs.start({
    blueprintName: "feature-planning",
    repo: "re-cinq/lore",
    branch: "lore/feature-planning/kpis",
    subjectKey: "plan:p1",
  });

  await runs.markRunning(id);

  if (open) {
    await runs.ensureStationRun({
      assemblyRunId: id,
      nodeId: open.nodeId,
      iteration: 1,
    });
  }

  return id;
}

function subject() {
  const runs = new InMemoryAssemblyRuns();
  const reporter = new InMemoryEventReporter();

  return { runs, reporter, deps: { runs, reporter, graphOf: async () => GRAPH } };
}

describe("runStation", () => {
  it("asks the Floor to run write in the same run parked on its author, naming gedaiu", async () => {
    const { runs, reporter, deps } = subject();
    const id = await lineWith(runs, { nodeId: "author" });

    const answered = await runStation(deps, {
      runId: id,
      nodeId: "write",
      actor: "gedaiu",
    });

    expect({ answered, events: reporter.rows }).toMatchObject({
      answered: id,
      events: [
        {
          event_name: "assembly_run.run_station",
          params: {
            assemblyRunId: id,
            nodeId: "write",
            actor: "gedaiu",
            repo: "re-cinq/lore",
          },
        },
      ],
    });
  });

  it("reopens a failed run before asking, so its page goes live again", async () => {
    const { runs, reporter, deps } = subject();
    const id = await lineWith(runs, null);

    await runs.finish(id, "error", "push pushed nothing");
    await runStation(deps, { runId: id, nodeId: "write", actor: "gedaiu" });

    expect({
      run: await runs.getById(id),
      events: reporter.rows.length,
    }).toMatchObject({
      run: { status: "running", outcome: null, reason: null },
      events: 1,
    });
  });

  it("refuses while the analyze station is still working, asking nothing", async () => {
    const { runs, reporter, deps } = subject();
    const id = await lineWith(runs, { nodeId: "analyze" });

    await expect(
      runStation(deps, { runId: id, nodeId: "write", actor: "gedaiu" }),
    ).rejects.toMatchObject({
      output: { statusCode: 409 },
      message: "the analyze station is still working; wait for it to finish",
    });
    expect(reporter.rows).toEqual([]);
  });

  it("refuses a node the run's graph does not have", async () => {
    const { runs, deps } = subject();
    const id = await lineWith(runs, null);

    await expect(
      runStation(deps, { runId: id, nodeId: "nope", actor: "gedaiu" }),
    ).rejects.toMatchObject({
      output: { statusCode: 400 },
      message: '"nope" is not a station of feature-planning',
    });
  });

  it("refuses to reopen an ended run when another open run took its subject, naming it", async () => {
    const { runs, deps } = subject();
    const id = await lineWith(runs, null);

    await runs.finish(id, "error", "died");
    const holder = await runs.start({
      blueprintName: "feature-planning",
      repo: "re-cinq/lore",
      subjectKey: "plan:p1",
    });

    await expect(
      runStation(deps, { runId: id, nodeId: "write", actor: "gedaiu" }),
    ).rejects.toMatchObject({
      output: { statusCode: 409 },
      message: `another run (${holder}) is already working plan:p1; wait for it or cancel it first`,
    });
    expect((await runs.getById(id))?.status).toBe("failed");
  });

  it("answers 404 for a run that does not exist", async () => {
    await expect(
      runStation(subject().deps, {
        runId: "nope",
        nodeId: "write",
        actor: "gedaiu",
      }),
    ).rejects.toMatchObject({ output: { statusCode: 404 } });
  });
});
