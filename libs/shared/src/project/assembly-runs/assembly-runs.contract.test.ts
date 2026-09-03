import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { InMemoryAssemblyRuns } from "./assembly-runs-memory.js";
import { PgAssemblyRuns } from "./assembly-runs-pg.js";
import type { AssemblyRunsPort } from "./assembly-runs-port.js";
import type { RunGraph } from "./run-graph.js";

const PG_CONFIG = {
  host: process.env.PGHOST ?? "localhost",
  port: Number(process.env.PGPORT ?? 5432),
  database: process.env.PGDATABASE ?? "lore",
  user: process.env.PGUSER ?? "lore",
  password: process.env.PGPASSWORD ?? "lore",
};

async function pgAvailable(): Promise<{ ok: boolean; why: string }> {
  let probe: Pool | undefined;

  try {
    probe = new Pool({ ...PG_CONFIG, connectionTimeoutMillis: 1000 });

    const { rows } = await probe.query<{ present: boolean }>(
      `SELECT to_regclass('pipeline.assembly_runs') IS NOT NULL AS present`,
    );

    return rows[0]?.present
      ? { ok: true, why: "" }
      : {
          ok: false,
          why: "pipeline.assembly_runs is absent — migrations not applied",
        };
  } catch (err) {
    return { ok: false, why: `unreachable: ${(err as Error).message}` };
  } finally {
    await probe?.end();
  }
}

const pg = await pgAvailable();

describe("the Postgres implementation is actually exercised", () => {
  it(
    pg.ok
      ? "runs against a migrated Postgres"
      : `SKIPPED — ${pg.why} (in-memory alone proves nothing about the SQL)`,
    () => {
      expect(pg.ok || process.env.LORE_REQUIRE_PG_CONTRACT !== "1").toBe(true);
    },
  );
});

const GRAPH: RunGraph = {
  name: "code-review",
  entry: "review",
  exit: "done",
  nodes: [
    {
      id: "review",
      type: "agent",
      station: "code-review",
      station_inherited: true,
    },
    {
      id: "done",
      type: "retrospective",
      station: "def-retrospective",
      station_inherited: true,
    },
  ],
  edges: [{ from: "review", to: "done", on: "success" }],
};

interface Subject {
  port: AssemblyRunsPort;
  repo: string;
  taskId: () => Promise<string>;
}

const pool = pg.ok ? new Pool(PG_CONFIG) : null;
const pgRepos: string[] = [];

afterAll(async () => {
  if (pool) {
    await pool.query(
      `DELETE FROM pipeline.assembly_runs WHERE repo = ANY($1)`,
      [pgRepos],
    );
    await pool.query(`DELETE FROM pipeline.tasks WHERE target_repo = ANY($1)`, [
      pgRepos,
    ]);
    await pool.end();
  }
});

const IMPLEMENTATIONS: Array<[string, () => Subject]> = [
  [
    "in-memory",
    () => ({
      port: new InMemoryAssemblyRuns(),
      repo: "re-cinq/contract",
      taskId: async () => randomUUID(),
    }),
  ],
];

if (pool) {
  IMPLEMENTATIONS.push([
    "postgres",
    () => {
      const repo = `re-cinq/contract-${randomUUID()}`;

      pgRepos.push(repo);

      return {
        port: new PgAssemblyRuns(pool),
        repo,
        taskId: async () => {
          const { rows } = await pool.query<{ id: string }>(
            `INSERT INTO pipeline.tasks (description, target_repo)
             VALUES ('contract suite', $1) RETURNING id`,
            [repo],
          );

          return rows[0].id;
        },
      };
    },
  ]);
}

describe.each(IMPLEMENTATIONS)(
  "AssemblyRunsPort contract (%s)",
  (_name, make) => {
    it("start persists a queued run that getById reads back", async () => {
      const { port, repo } = make();
      const id = await port.start({ blueprintName: "code-review", repo });

      expect(await port.getById(id)).toMatchObject({
        id,
        blueprintName: "code-review",
        repo,
        status: "queued",
        outcome: null,
        graph: null,
      });
    });

    it("stampBlueprint stores the hash and the cloned graph together", async () => {
      const { port, repo } = make();
      const id = await port.start({ blueprintName: "code-review", repo });

      await port.stampBlueprint(id, "hash-1", GRAPH);

      expect(await port.getById(id)).toMatchObject({
        blueprintHash: "hash-1",
        graph: GRAPH,
      });
    });

    it("stampBlueprint never overwrites a blueprint already stamped", async () => {
      const { port, repo } = make();
      const id = await port.start({ blueprintName: "code-review", repo });

      await port.stampBlueprint(id, "hash-1", GRAPH);
      await port.stampBlueprint(id, "hash-2", { ...GRAPH, name: "other" });

      expect(await port.getById(id)).toMatchObject({
        blueprintHash: "hash-1",
        graph: GRAPH,
      });
    });

    it("markRunning moves a queued run to running", async () => {
      const { port, repo } = make();
      const id = await port.start({ blueprintName: "code-review", repo });

      await port.markRunning(id);

      expect((await port.getById(id))?.status).toBe("running");
    });

    it("ensureStationRun mints a station run id and converges a duplicate onto it", async () => {
      const { port, repo } = make();
      const id = await port.start({ blueprintName: "code-review", repo });
      const first = await port.ensureStationRun({
        assemblyRunId: id,
        nodeId: "review",
        iteration: 1,
      });
      const duplicate = await port.ensureStationRun({
        assemblyRunId: id,
        nodeId: "review",
        iteration: 1,
      });

      expect(first.created).toBe(true);
      expect(duplicate.created).toBe(false);
      expect(duplicate.stationRunId).toBe(first.stationRunId);
      expect(duplicate.nodeRowId).toBe(first.nodeRowId);
    });

    it("ensureStationRun persists the input it is given and listStationRuns returns it", async () => {
      const { port, repo } = make();
      const id = await port.start({ blueprintName: "code-review", repo });

      await port.ensureStationRun({
        assemblyRunId: id,
        nodeId: "review",
        iteration: 1,
        input: {
          description: "review the PR",
          prompt: "you are a reviewer",
          params: null,
          repo,
          ref: "lore/impl-1",
        },
      });

      expect((await port.listStationRuns(id))[0].input).toEqual({
        description: "review the PR",
        prompt: "you are a reviewer",
        params: null,
        repo,
        ref: "lore/impl-1",
      });
    });

    it("a converged duplicate keeps the first visit's input rather than overwriting it", async () => {
      const { port, repo } = make();
      const id = await port.start({ blueprintName: "code-review", repo });
      const base = { assemblyRunId: id, nodeId: "review", iteration: 1 };

      await port.ensureStationRun({
        ...base,
        input: {
          description: "first",
          prompt: null,
          params: null,
          repo,
          ref: "b",
        },
      });
      await port.ensureStationRun({
        ...base,
        input: {
          description: "second",
          prompt: null,
          params: null,
          repo,
          ref: "b",
        },
      });

      expect((await port.listStationRuns(id))[0].input).toMatchObject({
        description: "first",
      });
    });

    it("a visit recorded without input reads back null", async () => {
      const { port, repo } = make();
      const id = await port.start({ blueprintName: "code-review", repo });

      await port.ensureStationRun({
        assemblyRunId: id,
        nodeId: "review",
        iteration: 1,
      });

      expect((await port.listStationRuns(id))[0].input).toBeNull();
    });

    it("a revisited node is a different visit with its own station run id", async () => {
      const { port, repo } = make();
      const id = await port.start({ blueprintName: "code-review", repo });
      const first = await port.ensureStationRun({
        assemblyRunId: id,
        nodeId: "review",
        iteration: 1,
      });
      const revisit = await port.ensureStationRun({
        assemblyRunId: id,
        nodeId: "review",
        iteration: 2,
      });

      expect(revisit.stationRunId).not.toBe(first.stationRunId);
    });

    it("finishStationRunOnce is compare-and-set: the first writer wins", async () => {
      const { port, repo } = make();
      const id = await port.start({ blueprintName: "code-review", repo });
      const { nodeRowId } = await port.ensureStationRun({
        assemblyRunId: id,
        nodeId: "review",
        iteration: 1,
      });

      expect(await port.finishStationRunOnce(nodeRowId, "success")).toBe(true);
      expect(await port.finishStationRunOnce(nodeRowId, "failed")).toBe(false);
      expect((await port.listStationRuns(id))[0]?.outcome).toBe("success");
    });

    it("records the failure class and detail a classified node failure carried", async () => {
      const { port, repo } = make();
      const id = await port.start({ blueprintName: "code-review", repo });
      const { nodeRowId } = await port.ensureStationRun({
        assemblyRunId: id,
        nodeId: "review",
        iteration: 1,
      });

      await port.finishStationRunOnce(nodeRowId, "failed", undefined, {
        failureClass: "anthropic-credit",
        failureDetail: "Credit balance is too low",
      });

      expect((await port.listStationRuns(id))[0]).toMatchObject({
        outcome: "failed",
        failureClass: "anthropic-credit",
        failureDetail: "Credit balance is too low",
      });
    });

    it("leaves the failure columns null for a node that simply succeeded", async () => {
      const { port, repo } = make();
      const id = await port.start({ blueprintName: "code-review", repo });
      const { nodeRowId } = await port.ensureStationRun({
        assemblyRunId: id,
        nodeId: "review",
        iteration: 1,
      });

      await port.finishStationRunOnce(nodeRowId, "success");

      expect((await port.listStationRuns(id))[0]).toMatchObject({
        failureClass: null,
        failureDetail: null,
      });
    });

    it("listStationRuns returns the run's visits in visit order", async () => {
      const { port, repo } = make();
      const id = await port.start({ blueprintName: "code-review", repo });

      for (const node of ["review", "refine", "done"]) {
        await port.ensureStationRun({
          assemblyRunId: id,
          nodeId: node,
          iteration: 1,
        });
      }

      expect((await port.listStationRuns(id)).map((row) => row.nodeId)).toEqual(
        ["review", "refine", "done"],
      );
    });

    it("finish closes the run, and a late finisher loses", async () => {
      const { port, repo } = make();
      const id = await port.start({ blueprintName: "code-review", repo });

      await port.markRunning(id);

      expect(await port.finish(id, "completed")).toBe(true);
      expect(await port.finish(id, "error", "late")).toBe(false);
      expect(await port.getById(id)).toMatchObject({
        status: "finished",
        outcome: "completed",
      });
    });

    it("finish with outcome error closes the run as failed", async () => {
      const { port, repo } = make();
      const id = await port.start({ blueprintName: "code-review", repo });

      await port.markRunning(id);
      await port.finish(id, "error", "no blueprint");

      expect(await port.getById(id)).toMatchObject({
        status: "failed",
        reason: "no blueprint",
      });
    });

    it("mergeArgs is additive by key and replaces a key it names", async () => {
      const { port, repo } = make();
      const id = await port.start({
        blueprintName: "code-review",
        repo,
        args: { description: "first", pr_number: 7 },
      });

      await port.mergeArgs(id, { spec_plan: "plan.json" });
      await port.mergeArgs(id, { description: "second" });

      expect((await port.getById(id))?.args).toMatchObject({
        description: "second",
        pr_number: 7,
        spec_plan: "plan.json",
      });
    });

    it("list narrows to one blueprint", async () => {
      const { port, repo } = make();
      const wanted = await port.start({ blueprintName: "code-review", repo });

      await port.start({ blueprintName: "implementation", repo });

      const ids = (await port.list({ repo, blueprintName: "code-review" })).map(
        (run) => run.id,
      );

      expect(ids).toContain(wanted);
      expect(ids).toHaveLength(1);
    });

    it("list narrows to one repo", async () => {
      const { port, repo } = make();
      const mine = await port.start({ blueprintName: "code-review", repo });

      await port.start({ blueprintName: "code-review", repo: `${repo}-other` });

      expect((await port.list({ repo })).map((run) => run.id)).toEqual([mine]);
    });

    it("list narrows by status", async () => {
      const { port, repo } = make();
      const running = await port.start({ blueprintName: "code-review", repo });

      await port.markRunning(running);
      await port.start({ blueprintName: "code-review", repo });

      expect(
        (await port.list({ repo, status: ["running"] })).map((run) => run.id),
      ).toEqual([running]);
    });

    it("listSummaries selects the same runs as list, without the graph clone", async () => {
      const { port, repo } = make();
      const wanted = await port.start({ blueprintName: "code-review", repo });

      await port.start({ blueprintName: "implementation", repo });

      const summaries = await port.listSummaries({
        repo,
        blueprintName: "code-review",
      });

      expect(summaries.map((run) => run.id)).toEqual([wanted]);
      expect(summaries[0]).not.toHaveProperty("graph");
    });

    it("list caps at the limit", async () => {
      const { port, repo } = make();

      for (let i = 0; i < 3; i++) {
        await port.start({ blueprintName: "code-review", repo });
      }

      expect(await port.list({ repo, limit: 2 })).toHaveLength(2);
    });

    it("listOpen returns queued and running runs, never a terminal one", async () => {
      const { port, repo } = make();
      const queued = await port.start({ blueprintName: "code-review", repo });
      const running = await port.start({ blueprintName: "code-review", repo });
      const closed = await port.start({ blueprintName: "code-review", repo });

      await port.markRunning(running);
      await port.markRunning(closed);
      await port.finish(closed, "completed");

      const ids = (await port.listOpen()).map((run) => run.id);

      expect(ids).toContain(queued);
      expect(ids).toContain(running);
      expect(ids).not.toContain(closed);
    });

    it("findOpenOnBranch returns open runs for that repo+branch as graph-less summaries", async () => {
      const { port, repo } = make();
      const branch = "feat/contract";
      const open = await port.start({
        blueprintName: "code-review",
        repo,
        branch,
      });
      const closed = await port.start({
        blueprintName: "code-review",
        repo,
        branch,
      });

      await port.start({
        blueprintName: "code-review",
        repo,
        branch: "feat/elsewhere",
      });
      await port.markRunning(closed);
      await port.finish(closed, "completed");

      const summaries = await port.findOpenOnBranch(repo, branch);

      expect(summaries.map((row) => row.id)).toEqual([open]);
      expect(summaries[0]).toMatchObject({ repo, branch, status: "queued" });
    });

    it("hasReviewedPr is true once ANY code-review run exists for the repo+PR, terminal included", async () => {
      const { port, repo } = make();
      const reviewed = await port.start({
        blueprintName: "code-review",
        repo,
        args: { pr_number: 7 },
      });

      await port.markRunning(reviewed);
      await port.finish(reviewed, "completed");

      expect(await port.hasReviewedPr(repo, 7)).toBe(true);
      expect(await port.hasReviewedPr(repo, 99)).toBe(false);
    });

    it("findOpenByPr finds BOTH a queued and a running run for that PR", async () => {
      const { port, repo } = make();
      const queued = await port.start({
        blueprintName: "code-review",
        repo,
        args: { pr_number: 4242 },
      });
      const running = await port.start({
        blueprintName: "code-review",
        repo,
        args: { pr_number: 4242 },
      });

      await port.markRunning(running);

      const ids = (await port.findOpenByPr(repo, 4242)).map((run) => run.id);

      expect(ids).toContain(queued);
      expect(ids).toContain(running);
    });

    it("finishOpenByPr closes only the definitions the caller names, leaving a parked planning run running (FR6.37)", async () => {
      const { port, repo } = make();
      const review = await port.start({
        blueprintName: "code-review",
        repo,
        args: { pr_number: 99 },
      });
      const planning = await port.start({
        blueprintName: "feature-planning",
        repo,
        args: { pr_number: 99 },
      });

      await port.markRunning(review);
      await port.markRunning(planning);

      expect(
        (await port.finishOpenByPr(repo, 99, "pr_closed", ["code-review"])).map(
          (run) => run.id,
        ),
      ).toEqual([review]);
      expect(await port.getById(review)).toMatchObject({
        status: "finished",
        outcome: "pr_closed",
      });
      expect((await port.getById(planning))?.status).toBe("running");
    });

    it("listForTask returns the run started for a task", async () => {
      const { port, repo, taskId: mintTask } = make();
      const taskId = await mintTask();
      const id = await port.start({
        blueprintName: "code-review",
        repo,
        taskId,
      });

      expect((await port.listForTask(taskId)).map((run) => run.id)).toEqual([
        id,
      ]);
    });
    it("start with a subject key already open returns the run already in flight", async () => {
      const { port, repo } = make();
      const first = await port.start({
        blueprintName: "feature-planning",
        repo,
        subjectKey: "feature:one",
      });
      const second = await port.start({
        blueprintName: "feature-finalize",
        repo,
        subjectKey: "feature:one",
      });

      expect(second).toBe(first);
    });

    it("start records the subject key on the run it mints", async () => {
      const { port, repo } = make();
      const id = await port.start({
        blueprintName: "feature-planning",
        repo,
        subjectKey: "feature:two",
      });

      expect(await port.getById(id)).toMatchObject({
        subjectKey: "feature:two",
      });
    });

    it("a settled run frees its subject key for the next start", async () => {
      const { port, repo } = make();
      const first = await port.start({
        blueprintName: "feature-planning",
        repo,
        subjectKey: "feature:three",
      });

      await port.finish(first, "completed");

      const second = await port.start({
        blueprintName: "feature-planning",
        repo,
        subjectKey: "feature:three",
      });

      expect(second).not.toBe(first);
    });

    it("runs carrying no subject key start independently of each other", async () => {
      const { port, repo } = make();
      const first = await port.start({ blueprintName: "comment-triage", repo });
      const second = await port.start({
        blueprintName: "comment-triage",
        repo,
      });

      expect(second).not.toBe(first);
    });

    it("the same subject key on two repos is two independent runs", async () => {
      const { port, repo } = make();
      const mine = await port.start({
        blueprintName: "feature-planning",
        repo,
        subjectKey: "feature:four",
      });
      const theirs = await port.start({
        blueprintName: "feature-planning",
        repo: `${repo}-other`,
        subjectKey: "feature:four",
      });

      expect(theirs).not.toBe(mine);
    });

    it("findOpenBySubject returns the open run for that subject", async () => {
      const { port, repo } = make();
      const id = await port.start({
        blueprintName: "feature-planning",
        repo,
        subjectKey: "feature:five",
      });

      expect(await port.findOpenBySubject(repo, "feature:five")).toMatchObject({
        id,
        status: "queued",
        repo,
        subjectKey: "feature:five",
      });
    });

    it("findOpenBySubject returns null once the run is settled", async () => {
      const { port, repo } = make();
      const id = await port.start({
        blueprintName: "feature-planning",
        repo,
        subjectKey: "feature:six",
      });

      await port.finish(id, "completed");

      expect(await port.findOpenBySubject(repo, "feature:six")).toBeNull();
    });

    it("countBySubject counts settled runs, so a re-starting sweep can be capped", async () => {
      const { port, repo } = make();

      expect(await port.countBySubject(repo, "merge:t-1")).toBe(0);

      for (const _attempt of [1, 2]) {
        const id = await port.start({
          blueprintName: "merge",
          repo,
          subjectKey: "merge:t-1",
        });

        await port.finish(id, "failed");
      }

      expect(await port.countBySubject(repo, "merge:t-1")).toBe(2);
      expect(await port.countBySubject(repo, "merge:other")).toBe(0);
    });

    it("findOpenBySubject returns null for a subject nothing is working", async () => {
      const { port, repo } = make();

      expect(await port.findOpenBySubject(repo, "feature:absent")).toBeNull();
    });

    it("list by subject returns that subject's runs whatever blueprint they ran", async () => {
      const { port, repo } = make();
      const planning = await port.start({
        blueprintName: "feature-planning",
        repo,
        subjectKey: "feature:seven",
      });

      await port.finish(planning, "completed");

      const finalize = await port.start({
        blueprintName: "feature-finalize",
        repo,
        subjectKey: "feature:seven",
      });

      expect(
        (await port.list({ repo, subjectKey: "feature:seven" }))
          .map((r) => r.id)
          .sort(),
      ).toEqual([finalize, planning].sort());
    });

    it("a fork takes over the subject of the run it forks from", async () => {
      const { port, repo } = make();
      const source = await port.start({
        blueprintName: "code-review",
        repo,
        subjectKey: "feature:eight",
      });

      await port.stampBlueprint(source, "hash-1", GRAPH);
      await port.markRunning(source);

      const { nodeRowId } = await port.ensureStationRun({
        assemblyRunId: source,
        nodeId: "review",
        iteration: 1,
      });

      await port.finishStationRunOnce(nodeRowId, "success");
      await port.finish(source, "failed");

      const fork = await port.start({
        blueprintName: "code-review",
        repo,
        blueprintHash: "hash-1",
        resumeFrom: { lineId: source, nodeId: "review" },
      });

      expect(await port.getById(fork)).toMatchObject({
        subjectKey: "feature:eight",
      });
      expect(await port.findOpenBySubject(repo, "feature:eight")).toMatchObject(
        {
          id: fork,
        },
      );
    });

    it("a fork inherits the source's visits but not their verdict", async () => {
      const { port, repo } = make();
      const source = await port.start({
        blueprintName: "code-review",
        repo,
      });

      await port.stampBlueprint(source, "hash-1", GRAPH);
      await port.markRunning(source);

      const { nodeRowId } = await port.ensureStationRun({
        assemblyRunId: source,
        nodeId: "review",
        iteration: 1,
      });

      await port.finishStationRunOnce(nodeRowId, "failed", undefined, {
        failureClass: "anthropic-credit",
        failureDetail: "Credit balance too low",
      });
      await port.finish(source, "failed");

      const fork = await port.start({
        blueprintName: "code-review",
        repo,
        blueprintHash: "hash-1",
        resumeFrom: { lineId: source, nodeId: "review" },
      });

      expect(await port.listStationRuns(fork)).toMatchObject([
        {
          nodeId: "review",
          outcome: "failed",
          failureClass: null,
          failureDetail: null,
        },
      ]);
    });

    it("claims the oldest queued run whose required tags the claimant satisfies", async () => {
      const { port, repo } = make();
      const runId = await port.start({ blueprintName: "code-review", repo });

      await port.ensureStationRun({
        assemblyRunId: runId,
        nodeId: "review",
        iteration: 1,
        agentCrName: "cr-review",
        status: "queued",
        requiredTags: ["gpu"],
        dispatchSpec: { taskType: "review", prompt: "p" },
      });

      expect(
        await port.claimNextStationRun({
          clusterAgentId: "22222222-2222-2222-2222-222222222222",
          tags: ["node:agent"],
        }),
      ).toBeNull();
      const claimed = await port.claimNextStationRun({
        clusterAgentId: "22222222-2222-2222-2222-222222222222",
        tags: ["gpu", "node:agent"],
      });

      expect(claimed).toMatchObject({
        assemblyRunId: runId,
        nodeId: "review",
        iteration: 1,
        agentCrName: "cr-review",
        dispatchSpec: { taskType: "review", prompt: "p" },
      });
      const visit = (await port.listStationRuns(runId))[0];

      expect(visit).toMatchObject({
        status: "claimed",
        clusterAgentId: "22222222-2222-2222-2222-222222222222",
      });
      expect(visit.claimedAt).toBeInstanceOf(Date);
    });

    it("a queued visit with no dispatch contract is not claimable", async () => {
      const { port, repo } = make();
      const runId = await port.start({ blueprintName: "code-review", repo });

      await port.ensureStationRun({
        assemblyRunId: runId,
        nodeId: "review",
        iteration: 1,
        status: "queued",
      });

      expect(
        await port.claimNextStationRun({
          clusterAgentId: "22222222-2222-2222-2222-222222222222",
          tags: [],
        }),
      ).toBeNull();
    });

    it("a claimed run is not claimable again, and a running row never is", async () => {
      const { port, repo } = make();
      const runId = await port.start({ blueprintName: "code-review", repo });

      const armed = await port.ensureStationRun({
        assemblyRunId: runId,
        nodeId: "review",
        iteration: 1,
        status: "queued",
      });

      await port.enqueueStationRunDispatch(armed.nodeRowId, { prompt: "p" });
      await port.ensureStationRun({
        assemblyRunId: runId,
        nodeId: "done",
        iteration: 1,
      });

      const first = await port.claimNextStationRun({
        clusterAgentId: "22222222-2222-2222-2222-222222222222",
        tags: [],
      });

      expect(first?.nodeId).toBe("review");
      expect(
        await port.claimNextStationRun({
          clusterAgentId: "33333333-3333-3333-3333-333333333333",
          tags: [],
        }),
      ).toBeNull();
    });

    it("counts open claims per cluster-agent, dropping finished and unclaimed visits", async () => {
      const { port, repo } = make();
      const agentId = randomUUID();
      const runId = await port.start({ blueprintName: "code-review", repo });
      const first = await port.ensureStationRun({
        assemblyRunId: runId,
        nodeId: "review",
        iteration: 1,
        status: "queued",
      });

      await port.enqueueStationRunDispatch(first.nodeRowId, { prompt: "p" });
      let claimed = await port.claimNextStationRun({
        clusterAgentId: agentId,
        tags: [],
      });

      while (claimed && claimed.assemblyRunId !== runId) {
        claimed = await port.claimNextStationRun({
          clusterAgentId: agentId,
          tags: [],
        });
      }
      await port.ensureStationRun({
        assemblyRunId: runId,
        nodeId: "done",
        iteration: 1,
      });

      expect((await port.countOpenClaimsByAgent())[agentId]).toBeGreaterThan(0);

      const before = (await port.countOpenClaimsByAgent())[agentId];

      await port.finishStationRunOnce(first.nodeRowId, "success");
      const after = (await port.countOpenClaimsByAgent())[agentId] ?? 0;

      expect(after).toBe(before - 1);
    });

    it("list({clusterAgentId}) returns only runs holding that agent's open claim", async () => {
      const { port, repo } = make();
      const agentId = "33333333-3333-3333-3333-333333333333";
      const claimedRunId = await port.start({
        blueprintName: "code-review",
        repo,
      });
      const idleRunId = await port.start({
        blueprintName: "code-review",
        repo,
      });
      const { nodeRowId } = await port.ensureStationRun({
        assemblyRunId: claimedRunId,
        nodeId: "review",
        iteration: 1,
        status: "queued",
      });

      await port.enqueueStationRunDispatch(nodeRowId, { prompt: "p" });
      await port.claimNextStationRun({ clusterAgentId: agentId, tags: [] });

      const held = await port.listSummaries({ clusterAgentId: agentId });

      expect(held.map((run) => run.id)).toEqual([claimedRunId]);
      expect(held.map((run) => run.id)).not.toContain(idleRunId);

      await port.finishStationRunOnce(nodeRowId, "success");

      expect(await port.listSummaries({ clusterAgentId: agentId })).toEqual([]);
    });

    it("arming a claimed row is a no-op, so a re-dispatch cannot rewrite what a pod is being built from", async () => {
      const { port, repo } = make();
      const runId = await port.start({ blueprintName: "code-review", repo });
      const { nodeRowId } = await port.ensureStationRun({
        assemblyRunId: runId,
        nodeId: "review",
        iteration: 1,
        status: "queued",
      });

      await port.enqueueStationRunDispatch(nodeRowId, { prompt: "first" });
      let claimed = await port.claimNextStationRun({
        clusterAgentId: randomUUID(),
        tags: [],
      });

      while (claimed && claimed.assemblyRunId !== runId) {
        claimed = await port.claimNextStationRun({
          clusterAgentId: randomUUID(),
          tags: [],
        });
      }
      await port.enqueueStationRunDispatch(nodeRowId, { prompt: "second" });

      expect(claimed?.dispatchSpec).toEqual({ prompt: "first" });
      await port.requeueStationRun(nodeRowId);
      const reclaimed = await port.claimNextStationRun({
        clusterAgentId: randomUUID(),
        tags: [],
      });

      expect(reclaimed?.dispatchSpec).toEqual({ prompt: "first" });
    });

    it("requeue resets the same row to queued and clears the claim; a finished visit refuses", async () => {
      const { port, repo } = make();
      const runId = await port.start({ blueprintName: "code-review", repo });
      const { nodeRowId } = await port.ensureStationRun({
        assemblyRunId: runId,
        nodeId: "review",
        iteration: 1,
        status: "queued",
      });

      await port.enqueueStationRunDispatch(nodeRowId, { prompt: "p" });
      await port.claimNextStationRun({
        clusterAgentId: "22222222-2222-2222-2222-222222222222",
        tags: [],
      });

      expect(await port.requeueStationRun(nodeRowId)).toBe(true);
      const visit = (await port.listStationRuns(runId))[0];

      expect(visit).toMatchObject({
        status: "queued",
        clusterAgentId: null,
        claimedAt: null,
      });
      expect((await port.listStationRuns(runId))[0].id).toBe(nodeRowId);

      await port.finishStationRunOnce(nodeRowId, "success");

      expect(await port.requeueStationRun(nodeRowId)).toBe(false);
    });

    it("requeue restarts the queue clock so the wait is measured from the requeue", async () => {
      const { port, repo } = make();
      const runId = await port.start({ blueprintName: "code-review", repo });
      const { nodeRowId } = await port.ensureStationRun({
        assemblyRunId: runId,
        nodeId: "review",
        iteration: 1,
        status: "queued",
      });

      await port.enqueueStationRunDispatch(nodeRowId, { prompt: "p" });
      await port.claimNextStationRun({
        clusterAgentId: "33333333-3333-3333-3333-333333333333",
        tags: [],
      });
      const enqueuedAt = (await port.listStationRuns(runId))[0].startedAt;

      await new Promise((resolve) => setTimeout(resolve, 10));
      await port.requeueStationRun(nodeRowId);

      expect(
        (await port.listStationRuns(runId))[0].startedAt.getTime(),
      ).toBeGreaterThan(enqueuedAt.getTime());
    });
  },
);
