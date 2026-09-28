import { describe, it, expect } from "vitest";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import type { LoreTaskSpec } from "@re-cinq/lore-shared";
import {
  parseAssemblyLine,
  type AssemblyLine,
} from "@re-cinq/lore-assembly-lines";
import { runStationByHand } from "./run-station-by-hand.js";
import { advanceLine } from "./advance-line.js";
import type { AdvanceDeps } from "./advance-deps.js";
import { RecordingPlanWriter } from "../../domain/plan-writer-recording.js";

const pushThenWait: AssemblyLine = parseAssemblyLine(`
name: push-then-wait
description: push, then wait on a person to merge
version: 1
entry: push
exit: done
nodes:
  - id: push
    type: agent
    prompt_ref: push-only
  - id: merged
    type: pr_review
    route: "{args.pr_url}"
  - id: done
    type: retrospective
edges:
  - from: push
    to: merged
    on: success
  - from: push
    to: done
    on: failed
  - from: push
    to: done
    on: changes_requested
  - from: merged
    to: done
    on: always
`);

const LINES = new Map<string, AssemblyLine>([["push-then-wait", pushThenWait]]);

const nothing = async (): Promise<void> => {};

function makeDeps(port: InMemoryAssemblyRuns) {
  const enqueued: LoreTaskSpec[] = [];
  const reopenedTasks: string[] = [];
  const armDispatch = port.enqueueStationRunDispatch.bind(port);

  port.enqueueStationRunDispatch = async (nodeRowId, dispatchSpec) => {
    enqueued.push(dispatchSpec as LoreTaskSpec);
    await armDispatch(nodeRowId, dispatchSpec);
  };
  const deps: AdvanceDeps & { reopenTask: (runId: string) => Promise<void> } = {
    assemblyRuns: port,
    definitions: async () => LINES,
    jobRuns: { complete: nothing, fail: nothing },
    plans: new RecordingPlanWriter(),
    cleanupToken: nothing,
    repoSettings: async () => null,
    resolveRecipe: async (_repo, promptRef) => ({ prompt: promptRef }),
    reopenTask: async (runId) => {
      reopenedTasks.push(runId);
    },
  };

  return { deps, enqueued, reopenedTasks };
}

async function lineWithVisits(
  port: InMemoryAssemblyRuns,
  visits: Array<{ nodeId: string; outcome: string | null }>,
): Promise<string> {
  const id = await port.start({
    blueprintName: "push-then-wait",
    repo: "re-cinq/lore",
    branch: "feat/x",
    args: { description: "ship it" },
  });

  await port.markRunning(id);

  for (const { nodeId, outcome } of visits) {
    const { nodeRowId } = await port.ensureStationRun({
      assemblyRunId: id,
      nodeId,
      iteration: 1,
    });

    if (outcome) {
      await port.finishStationRunOnce(nodeRowId, outcome);
    }
  }

  return id;
}

describe("running a station by hand starts its next iteration in the same run (fork-rerun-from-node FR8)", () => {
  it("reopens the failed run and enqueues push as iteration 2, recorded as run by gedaiu", async () => {
    const port = new InMemoryAssemblyRuns();
    const { deps, enqueued, reopenedTasks } = makeDeps(port);
    const id = await lineWithVisits(port, [
      { nodeId: "push", outcome: "failed" },
      { nodeId: "done", outcome: "success" },
    ]);

    await port.finish(id, "error", 'node "push" failed');

    await runStationByHand(id, { nodeId: "push", actor: "gedaiu" }, deps);

    expect({
      run: await port.getById(id),
      visit: port.nodes.at(-1),
      enqueued: enqueued.length,
      reopenedTasks,
    }).toMatchObject({
      run: { status: "running", outcome: null },
      visit: {
        nodeId: "push",
        iteration: 2,
        outcome: null,
        requestedBy: "gedaiu",
      },
      enqueued: 1,
      reopenedTasks: [id],
    });
  });

  it("closes the merged wait the line is parked on as cancelled and enqueues push as iteration 2", async () => {
    const port = new InMemoryAssemblyRuns();
    const { deps, enqueued } = makeDeps(port);
    const id = await lineWithVisits(port, [
      { nodeId: "push", outcome: "success" },
      { nodeId: "merged", outcome: null },
    ]);

    await runStationByHand(id, { nodeId: "push", actor: "gedaiu" }, deps);

    expect(
      port.nodes.map(({ nodeId, iteration, outcome, failureDetail }) => ({
        nodeId,
        iteration,
        outcome,
        failureDetail,
      })),
    ).toEqual([
      { nodeId: "push", iteration: 1, outcome: "success", failureDetail: null },
      {
        nodeId: "merged",
        iteration: 1,
        outcome: "cancelled",
        failureDetail: "gedaiu ran the push station by hand",
      },
      { nodeId: "push", iteration: 2, outcome: null, failureDetail: null },
    ]);
    expect(enqueued).toHaveLength(1);
  });

  it("leaves the merged wait parked and the run untouched when the push dispatch cannot be resolved", async () => {
    const port = new InMemoryAssemblyRuns();
    const { deps, enqueued } = makeDeps(port);
    const id = await lineWithVisits(port, [
      { nodeId: "push", outcome: "success" },
      { nodeId: "merged", outcome: null },
    ]);
    const noRecipe: AdvanceDeps = {
      ...deps,
      resolveRecipe: async () => {
        throw new Error('no prompt named "push-only"');
      },
    };

    await expect(
      runStationByHand(id, { nodeId: "push", actor: "gedaiu" }, noRecipe),
    ).rejects.toThrow('no prompt named "push-only"');

    expect({
      merged: port.nodes.find((row) => row.nodeId === "merged")?.outcome,
      pushRows: port.nodes.filter((row) => row.nodeId === "push").length,
      enqueued: enqueued.length,
      status: (await port.getById(id))?.status,
    }).toEqual({ merged: null, pushRows: 1, enqueued: 0, status: "running" });
  });

  it("launches nothing while the push pod is still running", async () => {
    const port = new InMemoryAssemblyRuns();
    const { deps, enqueued } = makeDeps(port);
    const id = await lineWithVisits(port, [{ nodeId: "push", outcome: null }]);

    await runStationByHand(id, { nodeId: "done", actor: "gedaiu" }, deps);

    expect(port.nodes).toHaveLength(1);
    expect(enqueued).toEqual([]);
  });

  it("walks on to merged once the hand-run push succeeds", async () => {
    const port = new InMemoryAssemblyRuns();
    const { deps } = makeDeps(port);
    const id = await lineWithVisits(port, [
      { nodeId: "push", outcome: "failed" },
      { nodeId: "done", outcome: "success" },
    ]);

    await port.finish(id, "error", 'node "push" failed');
    await runStationByHand(id, { nodeId: "push", actor: "gedaiu" }, deps);
    await port.finishStationRunOnce(port.nodes.at(-1)!.id, "success");
    await advanceLine(id, deps);

    expect(port.nodes.at(-1)).toMatchObject({
      nodeId: "merged",
      iteration: 2,
      outcome: null,
    });
  });
});
