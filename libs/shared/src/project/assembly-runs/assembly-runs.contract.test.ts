// The AssemblyRunsPort contract, run against EVERY implementation (#1230).
//
// Why this file exists. The port had two implementations tested in two different
// universes: `InMemoryAssemblyRuns` was checked for BEHAVIOUR — so it quietly
// became the spec — while `PgAssemblyRuns` was checked for SQL TEXT against a
// fake pool, which proves only that the string typed is the string meant. Both
// suites passed while the two disagreed, which is exactly how a renamed column
// shipped green in #1228 and had to be fixed in review.
//
// There was even a `describe` titled "plain start agrees across the adapter and
// the double" that asserted SQL text on one side and behaviour on the other.
// That is not agreement; it is two unrelated assertions sharing a block.
//
// So: ONE set of expectations, executed against both. The in-memory run is
// unconditional. The Postgres run needs a database with the migrations applied
// and SKIPS when there is none, warning loudly — a suite that quietly tested
// nothing would be worse than no suite.
//
// Where that database exists today: LOCALLY, via `npm run db:up &&
// scripts/infra/setup-local-schema.sh`. NOT in CI. The Integration Tests
// workflow hand-rolls a subset of the schema inline and never applies
// `ui-helm/migrations/`, so `pipeline.assembly_runs` is absent there and this
// half skips. Applying the chain to that baseline does not work either — 20 of
// the migrations need tables the inline subset lacks (llm_calls, memories,
// agent_definitions, chunks…), measured, not guessed.
//
// Closing that is a bigger change than this file: the integration database
// should come from the same source as production rather than a parallel
// hand-written one. Tracked separately — until then the Postgres half is a
// local gate, and the honest reading of a green CI run is "the in-memory
// implementation passed".
//
// Deliberately behavioural only. Nothing here asserts SQL text — that belongs in
// the adapter's own file, where it is a test of the implementation. What is
// asserted here is what any implementation must do, which is the thing the two
// were free to disagree about.

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

/**
 * Reachable AND migrated. Reachability alone is not enough: a database that
 * predates migration 0040 has no `pipeline.assembly_runs`, and every test would
 * fail on a missing relation rather than skip.
 */
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

/**
 * A skipped implementation must be VISIBLE. `console.warn` from module scope is
 * swallowed by the runner, so the state is asserted as a named test instead —
 * the reporter prints the reason either way.
 *
 * `LORE_REQUIRE_PG_CONTRACT=1` turns the skip into a failure. Any environment
 * that is supposed to have a migrated database sets it, so the Postgres half can
 * never quietly stop running there and leave a green tick meaning less than it
 * did yesterday.
 */
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
  /** A repo nobody else in this file uses, so filtered reads see only their own rows. */
  repo: string;
  /** A task id the store will ACCEPT. `assembly_runs.task_id` is a real foreign
   *  key in Postgres, so the contract cannot invent one — each implementation
   *  supplies an id that exists for it. */
  taskId: () => Promise<string>;
}

const pool = pg.ok ? new Pool(PG_CONFIG) : null;
const pgRepos: string[] = [];

afterAll(async () => {
  if (pool) {
    // Node rows cascade from the run rows; args/graph go with them.
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
    // A fixed repo is safe ONLY because `make()` hands back a fresh store per
    // test, so nothing leaks between them. Hoisting this into a shared instance
    // (a beforeEach refactor, say) would silently break every filtered read.
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
      // The relaunch door dispatches the same visit again; the row already names
      // what that visit was given, and the second call must not rewrite history.
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
      // The overlap guard's read. It compares five scalars, so the summary must
      // NOT haul the graph clone — and it must not see other branches, or a run
      // would defer to work it has nothing to do with.
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
      // The first-review-only guard: a push after the first review must not
      // re-review, so a FINISHED run still has to count.
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
      // Open means queued OR running: a run that has not started yet still holds
      // the PR, and missing it starts a second review on the same pull request.
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

    it("finishOpenByPr closes only the definitions the caller names", async () => {
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
        await port.finishOpenByPr(repo, 99, "pr_closed", ["code-review"]),
      ).toBe(1);
      // The count alone would pass even if the outcome were never written.
      expect(await port.getById(review)).toMatchObject({
        status: "finished",
        outcome: "pr_closed",
      });
      // The planning run was parked WAITING for that merge — closing it here is
      // the bug FR6.37 was written about.
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

      // Membership, not order: both runs are created in the same millisecond here,
      // and this port documents ties as stable-but-arbitrary in BOTH adapters. The
      // property under test is that the blueprint name is not a filter — the point
      // of a subject is finding the run without knowing which line produced it.
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

      // A fork RE-RUNS the same work, so it must hold the guard its source held and
      // answer the same subject query. Inheriting is safe precisely because forking
      // is legal only from a terminal run — the key is always free by then.
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

      // The copied row keeps WHAT happened and drops the classification of WHY,
      // which belongs to the attempt that is over. `getNextTransition` replays the
      // copied prefix and refuses a retry on a permanent failure — inherit the
      // verdict and a fork taken to rerun a credit failure dies of the failure
      // it exists to get past, on its first advance, right after someone tops
      // the account up.
      expect(await port.listStationRuns(fork)).toMatchObject([
        {
          nodeId: "review",
          outcome: "failed",
          failureClass: null,
          failureDetail: null,
        },
      ]);
    });

    // ── Pull-based dispatch (specs/running-stations-in-any-k8s-cluster FR3) ──

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
      // The count is deliberately global (the registered-clusters page reads
      // the whole fleet), so this test keys on an agent id nobody else uses.
      const agentId = randomUUID();
      const runId = await port.start({ blueprintName: "code-review", repo });
      const first = await port.ensureStationRun({
        assemblyRunId: runId,
        nodeId: "review",
        iteration: 1,
        status: "queued",
      });

      await port.enqueueStationRunDispatch(first.nodeRowId, { prompt: "p" });
      // The claim scan is global too — age this row to the front would race
      // other rows, so claim by TAG nobody else queues.
      // (Simpler: claim until this run's row is taken or the queue is dry.)
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
  },
);
