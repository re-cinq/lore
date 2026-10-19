import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import type { AssemblyRunSummary } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { makePool } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import { enrichmentsFor } from "./floor-run-enrichment.js";
import type { RunEnrichment } from "./run-row.js";

const PR_URL = "https://github.com/re-cinq/lore/pull/412";

const TASK_PR: RunEnrichment = {
  pr_url: "https://github.com/re-cinq/lore/pull/2629",
  task_pr_number: 2629,
  issue_url: "https://github.com/re-cinq/lore/issues/2349",
  issue_number: 2349,
  created_by: "implementation-loop",
  cost_usd: null,
};

const noTasks = async () => new Map<string, RunEnrichment>();

function floorRun(id: string, args: Record<string, unknown>) {
  const createdAt = new Date("2026-09-30T10:00:00.000Z");

  return {
    id,
    blueprintName: "code-review",
    taskId: null,
    repo: "re-cinq/lore",
    branch: null,
    subjectKey: null,
    args: { engine: "floor", ...args },
    status: "finished",
    outcome: "success",
    reason: null,
    blueprintHash: "hash-1",
    resumedFromRunId: null,
    resumedFromNodeId: null,
    inheritedNodeCount: 0,
    createdAt,
    startedAt: createdAt,
    finishedAt: createdAt,
  } satisfies AssemblyRunSummary;
}

const pool = makePool() as unknown as Pool;

describe("enrichmentsFor", () => {
  it("reads the costs of run-1 and run-2 in one lookup", async () => {
    const lookups: string[][] = [];
    const costs = async (runs: readonly { id: string }[]) => {
      lookups.push(runs.map((run) => run.id));

      return new Map([
        ["run-1", 0.42],
        ["run-2", 1.5],
      ]);
    };

    const enriched = await enrichmentsFor(
      pool,
      [floorRun("run-1", {}), floorRun("run-2", {})],
      { costsByRun: costs, taskJoin: noTasks },
    );

    expect([lookups, enriched.get("run-2")?.cost_usd]).toEqual([
      [["run-1", "run-2"]],
      1.5,
    ]);
  });

  it("takes the pull request of run-1 from its own start item and has no task", async () => {
    const enriched = await enrichmentsFor(
      pool,
      [floorRun("run-1", { pr_url: PR_URL })],
      { costsByRun: async () => new Map(), taskJoin: noTasks },
    );

    expect(enriched.get("run-1")).toEqual({
      pr_url: PR_URL,
      task_pr_number: null,
      issue_url: null,
      issue_number: null,
      created_by: null,
      cost_usd: null,
    });
  });

  it("takes pull request 2629 and issue 2349 of a loop run from its task, which its open-pr station wrote", async () => {
    const loopRun = { ...floorRun("run-loop", {}), taskId: "task-1" };

    const enriched = await enrichmentsFor(pool, [loopRun], {
      costsByRun: async () => new Map([["run-loop", 7.49]]),
      taskJoin: async () => new Map([["run-loop", TASK_PR]]),
    });

    expect(enriched.get("run-loop")).toEqual({ ...TASK_PR, cost_usd: 7.49 });
  });

  it("joins the task only for the floor runs that keep one", async () => {
    const joined: string[][] = [];

    await enrichmentsFor(
      pool,
      [
        floorRun("run-1", {}),
        { ...floorRun("run-loop", {}), taskId: "task-1" },
      ],
      {
        costsByRun: async () => new Map(),
        taskJoin: async (_pool, runs) => {
          joined.push(runs.map((run) => run.id));

          return new Map();
        },
      },
    );

    expect(joined).toEqual([[], ["run-loop"]]);
  });

  it("asks the floor for no cost when no run is on it", async () => {
    const lookups: number[] = [];

    await enrichmentsFor(pool, [], {
      costsByRun: async (runs) => (lookups.push(runs.length), new Map()),
      taskJoin: noTasks,
    });

    expect(lookups).toEqual([]);
  });
});
