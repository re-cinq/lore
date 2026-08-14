import { describe, it, expect } from "vitest";
import { PgAssemblyLines } from "./assembly-lines-pg.js";
import { InMemoryAssemblyLines } from "./assembly-lines-memory.js";
import { AssemblyLines } from "./assembly-lines.js";
import type { PgPool } from "../../memory-store.js";

function fakePool(rowsByCall: unknown[][] = []): {
  pool: PgPool;
  calls: Array<{ text: string; params?: unknown[] }>;
} {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  const pool: PgPool = {
    async query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }> {
      calls.push({ text, params });

      return { rows: (rowsByCall[calls.length - 1] ?? []) as T[] };
    },
  };

  return { pool, calls };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("PgAssemblyLines adapter", () => {
  it("start inserts the assembly line row and the assembly_line.start event in one atomic statement", async () => {
    const { pool, calls } = fakePool([[{ id: "al-1" }]]);

    const id = await new PgAssemblyLines(pool).start({
      definitionName: "implementation",
      repo: "re-cinq/lore",
      branch: "lore/implementation/x-12345678",
      taskId: "task-9",
      args: { spec: "specs/x/spec.md" },
    });

    expect(id).toBe("al-1");
    expect(calls).toHaveLength(1);
    const sql = calls[0]?.text ?? "";

    expect(sql).toContain("INSERT INTO pipeline.assembly_lines");
    expect(sql).toContain("INSERT INTO pipeline.events");
    expect(sql).toContain("'assembly_line.start'");
    expect(sql).toContain("'internal'");
    expect(sql).toContain("'assembly_line.start:' || al.id");
    expect(calls[0]?.params).toEqual([
      "implementation",
      "task-9",
      "re-cinq/lore",
      "lore/implementation/x-12345678",
      JSON.stringify({ spec: "specs/x/spec.md" }),
    ]);
  });

  it("start defaults branch, taskId, and args when omitted", async () => {
    const { pool, calls } = fakePool([[{ id: "al-2" }]]);

    await new PgAssemblyLines(pool).start({
      definitionName: "gap-fill",
      repo: "re-cinq/lore",
    });

    expect(calls[0]?.params).toEqual([
      "gap-fill",
      null,
      "re-cinq/lore",
      null,
      "{}",
    ]);
  });

  it("markRunning stamps status running and started_at, guarded against terminal rows", async () => {
    const { pool, calls } = fakePool();

    await new PgAssemblyLines(pool).markRunning("al-1");

    expect(calls[0]?.text).toContain("status = 'running'");
    expect(calls[0]?.text).toContain("started_at = now()");
    // Never resurrect a finished/failed row (retried start event race).
    expect(calls[0]?.text).toContain("status IN ('queued', 'running')");
    expect(calls[0]?.params).toEqual(["al-1"]);
  });

  it("finish stamps status finished with outcome and finished_at", async () => {
    const { pool, calls } = fakePool();

    await new PgAssemblyLines(pool).finish("al-1", "pr_created");

    expect(calls[0]?.text).toContain(
      "CASE WHEN $1 = 'error' THEN 'failed' ELSE 'finished' END",
    );
    expect(calls[0]?.text).toContain("finished_at = now()");
    expect(calls[0]?.params).toEqual(["pr_created", null, "al-1"]);
  });

  it("finish returns true when this call closed the row and false when it was already terminal", async () => {
    const { pool, calls } = fakePool([[{ id: "al-1" }], []]);
    const adapter = new PgAssemblyLines(pool);

    expect(await adapter.finish("al-1", "completed")).toBe(true);
    expect(await adapter.finish("al-1", "error", "late racer")).toBe(false);
    expect(calls[0]?.text).toContain("RETURNING id");
  });

  it("finish with outcome error records the reason", async () => {
    const { pool, calls } = fakePool();

    await new PgAssemblyLines(pool).finish(
      "al-1",
      "error",
      "lease held by other pod",
    );

    expect(calls[0]?.params).toEqual([
      "error",
      "lease held by other pod",
      "al-1",
    ]);
  });

  it("getById maps the row to an AssemblyLineRecord", async () => {
    const createdAt = new Date("2026-07-03T10:00:00Z");
    const { pool, calls } = fakePool([
      [
        {
          id: "al-1",
          definition_name: "implementation",
          task_id: "task-9",
          repo: "re-cinq/lore",
          branch: "lore/x",
          args: { spec: "s" },
          status: "running",
          outcome: null,
          reason: null,
          created_at: createdAt,
          started_at: createdAt,
          finished_at: null,
        },
      ],
    ]);

    const record = await new PgAssemblyLines(pool).getById("al-1");

    expect(calls[0]?.text).toContain("FROM pipeline.assembly_lines");
    expect(record).toEqual({
      id: "al-1",
      definitionName: "implementation",
      taskId: "task-9",
      repo: "re-cinq/lore",
      branch: "lore/x",
      args: { spec: "s" },
      status: "running",
      outcome: null,
      reason: null,
      createdAt,
      startedAt: createdAt,
      finishedAt: null,
    });
  });

  it("getById returns null for an unknown id", async () => {
    const { pool } = fakePool([[]]);

    expect(await new PgAssemblyLines(pool).getById("nope")).toBeNull();
  });

  it("getById maps null args to an empty object", async () => {
    const createdAt = new Date("2026-07-03T10:00:00Z");
    const { pool } = fakePool([
      [
        {
          id: "al-1",
          definition_name: "general",
          task_id: null,
          repo: "r/a",
          branch: null,
          args: null,
          status: "queued",
          outcome: null,
          reason: null,
          created_at: createdAt,
          started_at: null,
          finished_at: null,
        },
      ],
    ]);

    expect((await new PgAssemblyLines(pool).getById("al-1"))?.args).toEqual({});
  });

  it("listForTask returns newest-first records for the task", async () => {
    const { pool, calls } = fakePool([[]]);

    await new PgAssemblyLines(pool).listForTask("task-9");

    expect(calls[0]?.text).toContain("WHERE task_id = $1");
    expect(calls[0]?.text).toContain("ORDER BY created_at DESC");
    expect(calls[0]?.params).toEqual(["task-9"]);
  });

  it("findOpenByPr matches repo + args pr_number and only open statuses", async () => {
    const { pool, calls } = fakePool([[]]);

    await new PgAssemblyLines(pool).findOpenByPr("re-cinq/lore", 42);

    expect(calls[0]?.text).toContain("WHERE repo = $1");
    expect(calls[0]?.text).toContain("(args->>'pr_number')::int = $2");
    expect(calls[0]?.text).toContain("status IN ('queued', 'running')");
    expect(calls[0]?.params).toEqual(["re-cinq/lore", 42]);
  });

  it("finishOpenByPr closes matching open rows and returns the count", async () => {
    const { pool, calls } = fakePool([[{ id: "al-1" }, { id: "al-2" }]]);

    const count = await new PgAssemblyLines(pool).finishOpenByPr(
      "re-cinq/lore",
      42,
      "pr_closed",
    );

    expect(count).toBe(2);
    expect(calls[0]?.text).toContain("UPDATE pipeline.assembly_lines");
    expect(calls[0]?.text).toContain("WHERE repo = $2");
    expect(calls[0]?.text).toContain("(args->>'pr_number')::int = $3");
    expect(calls[0]?.text).toContain("status IN ('queued', 'running')");
    // $4 null = every definition; a caller owning only part of a PR's lifecycle
    // passes its own family instead.
    expect(calls[0]?.params).toEqual(["pr_closed", "re-cinq/lore", 42, null]);
  });

  it("hasReviewedPr matches repo + code-review + args pr_number", async () => {
    const { pool, calls } = fakePool([[{ "?column?": 1 }]]);

    const reviewed = await new PgAssemblyLines(pool).hasReviewedPr(
      "re-cinq/lore",
      42,
    );

    expect(reviewed).toBe(true);
    expect(calls[0]?.text).toContain("definition_name = 'code-review'");
    expect(calls[0]?.text).toContain("(args->>'pr_number')::int = $2");
    expect(calls[0]?.text).toContain("LIMIT 1");
    expect(calls[0]?.params).toEqual(["re-cinq/lore", 42]);
  });
});

describe("InMemoryAssemblyLines double", () => {
  it("start seeds a queued row with a fresh uuid and one assembly_line.start event", async () => {
    const assemblyLines = new InMemoryAssemblyLines();

    const id = await assemblyLines.start({
      definitionName: "implementation",
      repo: "re-cinq/lore",
      taskId: "task-9",
    });

    expect(id).toMatch(UUID_RE);
    expect(assemblyLines.rows).toMatchObject([
      {
        id,
        definitionName: "implementation",
        taskId: "task-9",
        repo: "re-cinq/lore",
        status: "queued",
        outcome: null,
      },
    ]);
    expect(assemblyLines.events).toMatchObject([
      {
        eventName: "assembly_line.start",
        source: "internal",
        dedupeKey: `assembly_line.start:${id}`,
        params: {
          assemblyLineId: id,
          definitionName: "implementation",
          repo: "re-cinq/lore",
          taskId: "task-9",
        },
      },
    ]);
  });

  it("markRunning transitions the matching row to running with started_at", async () => {
    const assemblyLines = new InMemoryAssemblyLines();
    const id = await assemblyLines.start({
      definitionName: "general",
      repo: "re-cinq/lore",
    });

    await assemblyLines.markRunning(id);

    expect(assemblyLines.rows[0]).toMatchObject({ status: "running" });
    expect(assemblyLines.rows[0]?.startedAt).not.toBeNull();
  });

  it("finish returns true for the first writer and false for the losing duplicate", async () => {
    const assemblyLines = new InMemoryAssemblyLines();
    const id = await assemblyLines.start({
      definitionName: "general",
      repo: "re-cinq/lore",
    });

    expect(await assemblyLines.finish(id, "completed")).toBe(true);
    expect(await assemblyLines.finish(id, "error")).toBe(false);
    expect(assemblyLines.rows[0]).toMatchObject({ outcome: "completed" });
  });

  it("finish with outcome pr_created closes the row as finished", async () => {
    const assemblyLines = new InMemoryAssemblyLines();
    const id = await assemblyLines.start({
      definitionName: "general",
      repo: "re-cinq/lore",
    });

    await assemblyLines.finish(id, "pr_created");

    expect(assemblyLines.rows[0]).toMatchObject({
      status: "finished",
      outcome: "pr_created",
      reason: null,
    });
    expect(assemblyLines.rows[0]?.finishedAt).not.toBeNull();
  });

  it("finish with outcome error closes the row as failed with the reason", async () => {
    const assemblyLines = new InMemoryAssemblyLines();
    const id = await assemblyLines.start({
      definitionName: "general",
      repo: "re-cinq/lore",
    });

    await assemblyLines.finish(id, "error", "iteration_max exceeded");

    expect(assemblyLines.rows[0]).toMatchObject({
      status: "failed",
      outcome: "error",
      reason: "iteration_max exceeded",
    });
  });

  it("ensureNodeStart and finishNodeOnce trace one node execution", async () => {
    const assemblyLines = new InMemoryAssemblyLines();
    const id = await assemblyLines.start({
      definitionName: "implementation",
      repo: "re-cinq/lore",
    });

    const { nodeRowId } = await assemblyLines.ensureNodeStart({
      assemblyLineId: id,
      nodeId: "implement",
      iteration: 1,
      agentCrName: "al1abcde-implement",
    });

    await assemblyLines.finishNodeOnce(nodeRowId, "success", "deadbeef");

    expect(assemblyLines.nodes).toMatchObject([
      {
        id: nodeRowId,
        assemblyLineId: id,
        nodeId: "implement",
        iteration: 1,
        agentCrName: "al1abcde-implement",
        outcome: "success",
        commitSha: "deadbeef",
      },
    ]);
    expect(assemblyLines.nodes[0]?.finishedAt).not.toBeNull();
  });

  it("ensureNodeStart without an agent CR name stores null", async () => {
    const assemblyLines = new InMemoryAssemblyLines();
    const id = await assemblyLines.start({
      definitionName: "general",
      repo: "re-cinq/lore",
    });

    const { nodeRowId } = await assemblyLines.ensureNodeStart({
      assemblyLineId: id,
      nodeId: "validate",
      iteration: 1,
    });

    await assemblyLines.finishNodeOnce(nodeRowId, "failed");

    expect(assemblyLines.nodes[0]).toMatchObject({
      agentCrName: null,
      commitSha: null,
      outcome: "failed",
    });
  });

  it("throws on unknown ids for markRunning and returns false for finishNodeOnce", async () => {
    const assemblyLines = new InMemoryAssemblyLines();

    await expect(assemblyLines.markRunning("nope")).rejects.toThrow(
      new Error('no assembly line "nope"'),
    );
    await expect(assemblyLines.finish("nope", "error")).rejects.toThrow(
      new Error('no assembly line "nope"'),
    );
    expect(await assemblyLines.finishNodeOnce("nope", "success")).toBe(false);
  });

  it("getById returns the record and null for unknown ids", async () => {
    const assemblyLines = new InMemoryAssemblyLines();
    const id = await assemblyLines.start({
      definitionName: "general",
      repo: "re-cinq/lore",
    });

    expect(await assemblyLines.getById(id)).toMatchObject({
      id,
      definitionName: "general",
    });
    expect(await assemblyLines.getById("nope")).toBeNull();
  });

  it("listForTask returns only that task's assembly lines, newest first", async () => {
    const assemblyLines = new InMemoryAssemblyLines(
      () => new Date("2026-07-03T10:00:00Z"),
    );
    const first = await assemblyLines.start({
      definitionName: "general",
      repo: "r/a",
      taskId: "task-1",
    });

    assemblyLines.clock = () => new Date("2026-07-03T11:00:00Z");
    const second = await assemblyLines.start({
      definitionName: "general",
      repo: "r/a",
      taskId: "task-1",
    });

    await assemblyLines.start({
      definitionName: "general",
      repo: "r/a",
      taskId: "task-2",
    });

    const forTask = await assemblyLines.listForTask("task-1");

    expect(forTask.map((r) => r.id)).toEqual([second, first]);
  });

  it("findOpenByPr returns open rows for the repo+PR, excluding finished and other PRs", async () => {
    const assemblyLines = new InMemoryAssemblyLines();
    const open = await assemblyLines.start({
      definitionName: "code-review",
      repo: "r/a",
      args: { pr_number: 42 },
    });
    const done = await assemblyLines.start({
      definitionName: "code-review",
      repo: "r/a",
      args: { pr_number: 42 },
    });

    await assemblyLines.finish(done, "success");
    await assemblyLines.start({
      definitionName: "code-review",
      repo: "r/a",
      args: { pr_number: 99 },
    });
    await assemblyLines.start({
      definitionName: "code-review",
      repo: "r/b",
      args: { pr_number: 42 },
    });

    const found = await assemblyLines.findOpenByPr("r/a", 42);

    expect(found.map((r) => r.id)).toEqual([open]);
  });

  // A merged spec PR closes the code-review line for that PR — and used to close the
  // FEATURE-PLANNING line parked on `merged` for the same PR, killing the feature one
  // step before decomposition. The port's doc asserted "only code-review lines carry
  // pr_number in args", which stopped being true when the push node began stamping it
  // on the planning line.
  it("finishOpenByPr leaves a line outside the named definitions alone", async () => {
    const assemblyLines = new InMemoryAssemblyLines();
    const review = await assemblyLines.start({
      definitionName: "code-review",
      repo: "r/a",
      args: { pr_number: 42 },
    });
    const planning = await assemblyLines.start({
      definitionName: "feature-planning",
      repo: "r/a",
      args: { pr_number: 42 },
    });

    const count = await assemblyLines.finishOpenByPr("r/a", 42, "pr_closed", [
      "code-review",
    ]);

    expect(count).toBe(1);
    expect(await assemblyLines.getById(review)).toMatchObject({
      status: "finished",
    });
    expect(await assemblyLines.getById(planning)).toMatchObject({
      status: "queued",
      outcome: null,
    });
  });

  it("finishOpenByPr with no definition filter still closes every open line", async () => {
    const assemblyLines = new InMemoryAssemblyLines();

    await assemblyLines.start({
      definitionName: "feature-planning",
      repo: "r/a",
      args: { pr_number: 42 },
    });

    expect(await assemblyLines.finishOpenByPr("r/a", 42, "pr_closed")).toBe(1);
  });

  it("finishOpenByPr closes only the open matching rows and returns the count", async () => {
    const assemblyLines = new InMemoryAssemblyLines();
    const a = await assemblyLines.start({
      definitionName: "code-review",
      repo: "r/a",
      args: { pr_number: 42 },
    });
    const other = await assemblyLines.start({
      definitionName: "code-review",
      repo: "r/a",
      args: { pr_number: 99 },
    });

    const count = await assemblyLines.finishOpenByPr("r/a", 42, "pr_closed");

    expect(count).toBe(1);
    expect(await assemblyLines.getById(a)).toMatchObject({
      status: "finished",
      outcome: "pr_closed",
    });
    expect(await assemblyLines.getById(other)).toMatchObject({
      status: "queued",
    });
  });

  it("hasReviewedPr is true once any code-review line ran, false otherwise", async () => {
    const assemblyLines = new InMemoryAssemblyLines();
    const reviewed = await assemblyLines.start({
      definitionName: "code-review",
      repo: "r/a",
      args: { pr_number: 42 },
    });

    await assemblyLines.finish(reviewed, "success");
    await assemblyLines.start({
      definitionName: "comment-triage",
      repo: "r/a",
      args: { pr_number: 99 },
    });

    expect(await assemblyLines.hasReviewedPr("r/a", 42)).toBe(true);
    expect(await assemblyLines.hasReviewedPr("r/a", 99)).toBe(false);
    expect(await assemblyLines.hasReviewedPr("r/b", 42)).toBe(false);
  });
});

describe("AssemblyLines facade", () => {
  it("start fills the repo from the facade scope and returns the assemblyLineId", async () => {
    const port = new InMemoryAssemblyLines();
    const facade = new AssemblyLines("re-cinq/lore", port);

    const id = await facade.start("implementation", { taskId: "task-9" });

    expect(port.rows[0]).toMatchObject({
      id,
      definitionName: "implementation",
      repo: "re-cinq/lore",
      taskId: "task-9",
    });
  });

  it("listForTask and getById pass through to the port", async () => {
    const port = new InMemoryAssemblyLines();
    const facade = new AssemblyLines("re-cinq/lore", port);
    const id = await facade.start("general", { taskId: "task-1" });

    expect(await facade.getById(id)).toMatchObject({ id });
    expect(await facade.listForTask("task-1")).toHaveLength(1);
  });

  it("findOpenByPr and finishOpenByPr fill the repo from the facade scope", async () => {
    const port = new InMemoryAssemblyLines();
    const facade = new AssemblyLines("re-cinq/lore", port);
    const id = await facade.start("code-review", { args: { pr_number: 7 } });

    expect((await facade.findOpenByPr(7)).map((r) => r.id)).toEqual([id]);
    expect(await facade.finishOpenByPr(7, "pr_closed")).toBe(1);
    expect(await facade.getById(id)).toMatchObject({
      status: "finished",
      outcome: "pr_closed",
    });
  });
});

// ── Event-driven walk reads/writes (FR6.8 successors): the transition machinery
//    derives the walk state from node rows, so duplicates must converge structurally.
describe("InMemoryAssemblyLines node-transition primitives", () => {
  async function lineWithId(port: InMemoryAssemblyLines) {
    return port.start({ definitionName: "implementation", repo: "o/r" });
  }

  it("ensureNodeStart creates the (line, node, iteration) row once and converges duplicates onto it", async () => {
    const port = new InMemoryAssemblyLines();
    const id = await lineWithId(port);

    const first = await port.ensureNodeStart({
      assemblyLineId: id,
      nodeId: "review",
      iteration: 1,
      agentCrName: "abcd1234-review",
    });
    const second = await port.ensureNodeStart({
      assemblyLineId: id,
      nodeId: "review",
      iteration: 1,
      agentCrName: "abcd1234-review",
    });

    expect(first.created).toBe(true);
    expect(second).toEqual({ nodeRowId: first.nodeRowId, created: false });
    expect(port.nodes).toHaveLength(1);
  });

  it("ensureNodeStart treats a new iteration of the same node as a fresh row", async () => {
    const port = new InMemoryAssemblyLines();
    const id = await lineWithId(port);

    const first = await port.ensureNodeStart({
      assemblyLineId: id,
      nodeId: "implement",
      iteration: 1,
    });
    const second = await port.ensureNodeStart({
      assemblyLineId: id,
      nodeId: "implement",
      iteration: 2,
    });

    expect(second.created).toBe(true);
    expect(second.nodeRowId).not.toBe(first.nodeRowId);
  });

  it("finishNodeOnce wins the first write and rejects the second (CAS on null outcome)", async () => {
    const port = new InMemoryAssemblyLines();
    const id = await lineWithId(port);
    const { nodeRowId } = await port.ensureNodeStart({
      assemblyLineId: id,
      nodeId: "review",
      iteration: 1,
    });

    expect(await port.finishNodeOnce(nodeRowId, "success", "sha-1")).toBe(true);
    expect(await port.finishNodeOnce(nodeRowId, "failed")).toBe(false);
    expect(port.nodes[0]).toMatchObject({
      outcome: "success",
      commitSha: "sha-1",
    });
  });

  it("listNodes returns the line's rows in visit order and excludes other lines", async () => {
    const port = new InMemoryAssemblyLines();
    const id = await lineWithId(port);
    const other = await lineWithId(port);

    await port.ensureNodeStart({
      assemblyLineId: id,
      nodeId: "implement",
      iteration: 1,
    });
    await port.ensureNodeStart({
      assemblyLineId: other,
      nodeId: "review",
      iteration: 1,
    });
    await port.ensureNodeStart({
      assemblyLineId: id,
      nodeId: "ci",
      iteration: 1,
    });

    expect((await port.listNodes(id)).map((n) => n.nodeId)).toEqual([
      "implement",
      "ci",
    ]);
  });

  it("listOpen returns queued and running rows only", async () => {
    const port = new InMemoryAssemblyLines();
    const queued = await lineWithId(port);
    const running = await lineWithId(port);
    const done = await lineWithId(port);

    await port.markRunning(running);
    await port.markRunning(done);
    await port.finish(done, "completed");

    expect((await port.listOpen()).map((r) => r.id)).toEqual([queued, running]);
  });
});

describe("PgAssemblyLines node-transition primitives", () => {
  it("ensureNodeStart upserts with ON CONFLICT DO UPDATE (locks + returns in the concurrent case) and reports created via xmax", async () => {
    const { pool, calls } = fakePool([[{ id: 42, created: true }]]);

    const result = await new PgAssemblyLines(pool).ensureNodeStart({
      assemblyLineId: "al-1",
      nodeId: "review",
      iteration: 1,
      agentCrName: "abcd1234-review",
    });

    expect(result).toEqual({ nodeRowId: "42", created: true });
    const sql = calls[0]?.text ?? "";

    // DO UPDATE (not DO NOTHING) so the row is returned even when a concurrent
    // insert won the conflict; xmax=0 distinguishes create from converged dup.
    expect(sql).toContain("ON CONFLICT (assembly_line_id, node_id, iteration)");
    expect(sql).toContain("DO UPDATE");
    expect(sql).toContain("(xmax = 0) AS created");
    expect(calls[0]?.params).toEqual(["al-1", "review", 1, "abcd1234-review"]);
  });

  it("ensureNodeStart reports created:false for a converged duplicate (xmax != 0)", async () => {
    const { pool } = fakePool([[{ id: 42, created: false }]]);

    expect(
      await new PgAssemblyLines(pool).ensureNodeStart({
        assemblyLineId: "al-1",
        nodeId: "review",
        iteration: 1,
      }),
    ).toEqual({ nodeRowId: "42", created: false });
  });

  it("ensureNodeStart enforces exactly one returned row (invariant names itself)", async () => {
    const { pool } = fakePool([[]]);

    await expect(
      new PgAssemblyLines(pool).ensureNodeStart({
        assemblyLineId: "al-1",
        nodeId: "review",
        iteration: 1,
      }),
    ).rejects.toThrow(/expected exactly one row/);
  });

  it("finishNodeOnce CASes on a null outcome and reports whether it won", async () => {
    const { pool, calls } = fakePool([[{ id: 42 }], []]);
    const pg = new PgAssemblyLines(pool);

    expect(await pg.finishNodeOnce("42", "success", "sha-1")).toBe(true);
    expect(await pg.finishNodeOnce("42", "failed")).toBe(false);
    const sql = calls[0]?.text ?? "";

    expect(sql).toContain("outcome IS NULL");
    expect(sql).toContain("RETURNING id");
    expect(calls[0]?.params).toEqual(["success", "sha-1", "42"]);
  });

  it("listNodes selects the line's rows ordered by id", async () => {
    const { pool, calls } = fakePool([
      [
        {
          id: 1,
          assembly_line_id: "al-1",
          node_id: "implement",
          iteration: 1,
          outcome: "success",
          agent_cr_name: "abcd1234-implement",
          commit_sha: "sha-1",
          started_at: new Date("2026-07-14T00:00:00Z"),
          finished_at: new Date("2026-07-14T00:01:00Z"),
        },
      ],
    ]);

    const nodes = await new PgAssemblyLines(pool).listNodes("al-1");

    expect(nodes).toEqual([
      {
        id: "1",
        assemblyLineId: "al-1",
        nodeId: "implement",
        iteration: 1,
        outcome: "success",
        agentCrName: "abcd1234-implement",
        commitSha: "sha-1",
        startedAt: new Date("2026-07-14T00:00:00Z"),
        finishedAt: new Date("2026-07-14T00:01:00Z"),
      },
    ]);
    expect(calls[0]?.text).toContain("ORDER BY id");
    expect(calls[0]?.params).toEqual(["al-1"]);
  });

  it("listOpen selects queued and running rows oldest-first", async () => {
    const { pool, calls } = fakePool([[]]);

    await new PgAssemblyLines(pool).listOpen();

    expect(calls[0]?.text).toContain("status IN ('queued', 'running')");
    expect(calls[0]?.text).toContain("ORDER BY created_at");
  });
});

describe("finish is first-writer-wins", () => {
  it("does not overwrite an already-terminal row (InMemory)", async () => {
    const port = new InMemoryAssemblyLines();
    const id = await port.start({ definitionName: "code-review", repo: "o/r" });

    await port.markRunning(id);
    await port.finish(id, "completed");
    await port.finish(id, "error", "late duplicate");

    expect(await port.getById(id)).toMatchObject({
      status: "finished",
      outcome: "completed",
      reason: null,
    });
  });

  it("guards the Pg UPDATE on a non-terminal status", async () => {
    const { pool, calls } = fakePool();

    await new PgAssemblyLines(pool).finish("al-1", "completed");

    expect(calls[0]?.text).toContain("status IN ('queued', 'running')");
  });
});

// ── Definition hashing (specs/fork-rerun-from-node FR4): the stamp names the
//    graph a line's node rows were produced by, so a fork can refuse to replay
//    them against a definition that has since changed.
describe("stampDefinitionHash", () => {
  it("issues a write-once UPDATE guarded on a null hash (Pg)", async () => {
    const { pool, calls } = fakePool();

    await new PgAssemblyLines(pool).stampDefinitionHash("al-1", "hash-1");

    expect(calls[0]?.text).toContain("SET definition_hash = $2");
    expect(calls[0]?.text).toContain("definition_hash IS NULL");
    expect(calls[0]?.params).toEqual(["al-1", "hash-1"]);
  });

  it("records the hash on a line that has none", async () => {
    const port = new InMemoryAssemblyLines();
    const id = await port.start({ definitionName: "general", repo: "o/r" });

    await port.stampDefinitionHash(id, "hash-1");

    expect(await port.getById(id)).toMatchObject({ definitionHash: "hash-1" });
  });

  it("never overwrites an already-stamped hash, so a redelivered start cannot rewrite history", async () => {
    const port = new InMemoryAssemblyLines();
    const id = await port.start({ definitionName: "general", repo: "o/r" });

    await port.stampDefinitionHash(id, "hash-1");
    await port.stampDefinitionHash(id, "hash-2");

    expect(await port.getById(id)).toMatchObject({ definitionHash: "hash-1" });
  });

  it("throws on an unknown line id", async () => {
    const port = new InMemoryAssemblyLines();

    await expect(port.stampDefinitionHash("nope", "hash-1")).rejects.toThrow(
      new Error('no assembly line "nope"'),
    );
  });
});

// ── Fork-and-rerun (specs/fork-rerun-from-node FR1–FR3): the double is the
//    behavioural spec — the Pg adapter's resume CTE has to match it row for row.
describe("InMemoryAssemblyLines resumeFrom", () => {
  const HASH = "hash-implementation";

  async function terminalSource(port: InMemoryAssemblyLines): Promise<string> {
    const id = await port.start({
      definitionName: "implementation",
      repo: "o/r",
      branch: "lore/implementation/x",
      taskId: "task-9",
      args: { spec: "specs/x/spec.md" },
    });

    await port.stampDefinitionHash(id, HASH);
    await port.markRunning(id);

    for (const visit of [
      { nodeId: "implement", iteration: 1, outcome: "success" },
      { nodeId: "review", iteration: 1, outcome: "changes_requested" },
      { nodeId: "implement", iteration: 2, outcome: "success" },
      { nodeId: "review", iteration: 2, outcome: "failed" },
    ]) {
      const { nodeRowId } = await port.ensureNodeStart({
        assemblyLineId: id,
        nodeId: visit.nodeId,
        iteration: visit.iteration,
        agentCrName: `${id.slice(0, 12)}-${visit.nodeId}`,
      });

      await port.finishNodeOnce(
        nodeRowId,
        visit.outcome,
        `sha-${visit.nodeId}`,
      );
    }
    await port.finish(id, "error", "node failed");

    return id;
  }

  it("mints a fresh line inheriting branch, taskId and args from the source", async () => {
    const port = new InMemoryAssemblyLines();
    const source = await terminalSource(port);

    const fork = await port.start({
      definitionName: "implementation",
      repo: "o/r",
      definitionHash: HASH,
      resumeFrom: { lineId: source, nodeId: "implement" },
    });

    expect(fork).not.toBe(source);
    expect(await port.getById(fork)).toMatchObject({
      status: "queued",
      branch: "lore/implementation/x",
      taskId: "task-9",
      args: { spec: "specs/x/spec.md" },
      definitionHash: HASH,
      resumedFromLineId: source,
      resumedFromNodeId: "implement",
    });
  });

  it("copies the source rows through the chosen node's latest completed row, in visit order, with agent CR names nulled", async () => {
    const port = new InMemoryAssemblyLines();
    const source = await terminalSource(port);

    const fork = await port.start({
      definitionName: "implementation",
      repo: "o/r",
      definitionHash: HASH,
      resumeFrom: { lineId: source, nodeId: "implement" },
    });

    expect(
      (await port.listNodes(fork)).map((n) => ({
        nodeId: n.nodeId,
        iteration: n.iteration,
        outcome: n.outcome,
        commitSha: n.commitSha,
        agentCrName: n.agentCrName,
      })),
    ).toEqual([
      {
        nodeId: "implement",
        iteration: 1,
        outcome: "success",
        commitSha: "sha-implement",
        agentCrName: null,
      },
      {
        nodeId: "review",
        iteration: 1,
        outcome: "changes_requested",
        commitSha: "sha-review",
        agentCrName: null,
      },
      {
        nodeId: "implement",
        iteration: 2,
        outcome: "success",
        commitSha: "sha-implement",
        agentCrName: null,
      },
    ]);
  });

  it("leaves the source line and its node rows untouched", async () => {
    const port = new InMemoryAssemblyLines();
    const source = await terminalSource(port);

    await port.start({
      definitionName: "implementation",
      repo: "o/r",
      definitionHash: HASH,
      resumeFrom: { lineId: source, nodeId: "review" },
    });

    expect(await port.getById(source)).toMatchObject({
      status: "failed",
      outcome: "error",
      resumedFromLineId: null,
    });
    expect(await port.listNodes(source)).toHaveLength(4);
  });

  it("replaces args wholesale when the fork supplies them", async () => {
    const port = new InMemoryAssemblyLines();
    const source = await terminalSource(port);

    const fork = await port.start({
      definitionName: "implementation",
      repo: "o/r",
      definitionHash: HASH,
      args: { spec: "specs/y/spec.md" },
      resumeFrom: { lineId: source, nodeId: "implement" },
    });

    expect(await port.getById(fork)).toMatchObject({
      args: { spec: "specs/y/spec.md" },
    });
  });

  it("emits one assembly_line.start event carrying the fork parentage", async () => {
    const port = new InMemoryAssemblyLines();
    const source = await terminalSource(port);

    const fork = await port.start({
      definitionName: "implementation",
      repo: "o/r",
      definitionHash: HASH,
      resumeFrom: { lineId: source, nodeId: "implement" },
    });

    expect(port.events.at(-1)).toMatchObject({
      eventName: "assembly_line.start",
      source: "internal",
      dedupeKey: `assembly_line.start:${fork}`,
      params: {
        assemblyLineId: fork,
        branch: "lore/implementation/x",
        taskId: "task-9",
        resumedFrom: { lineId: source, nodeId: "implement" },
      },
    });
  });

  it("records no parentage and no event resumedFrom on a plain start", async () => {
    const port = new InMemoryAssemblyLines();

    const id = await port.start({ definitionName: "general", repo: "o/r" });

    expect(await port.getById(id)).toMatchObject({
      resumedFromLineId: null,
      resumedFromNodeId: null,
    });
    expect(port.events[0]?.params.resumedFrom).toBeNull();
  });

  it("writes nothing when validation rejects the fork", async () => {
    const port = new InMemoryAssemblyLines();
    const source = await terminalSource(port);
    const rowsBefore = port.rows.length;
    const nodesBefore = port.nodes.length;
    const eventsBefore = port.events.length;

    await expect(
      port.start({
        definitionName: "implementation",
        repo: "o/r",
        definitionHash: "hash-drifted",
        resumeFrom: { lineId: source, nodeId: "implement" },
      }),
    ).rejects.toThrow(/has changed since that run/);
    expect(port.rows).toHaveLength(rowsBefore);
    expect(port.nodes).toHaveLength(nodesBefore);
    expect(port.events).toHaveLength(eventsBefore);
  });

  it("refuses a live source line", async () => {
    const port = new InMemoryAssemblyLines();
    const source = await terminalSource(port);
    const live = await port.start({
      definitionName: "implementation",
      repo: "o/r",
      branch: "lore/implementation/y",
    });

    await port.stampDefinitionHash(live, HASH);
    await port.markRunning(live);

    await expect(
      port.start({
        definitionName: "implementation",
        repo: "o/r",
        definitionHash: HASH,
        resumeFrom: { lineId: live, nodeId: "implement" },
      }),
    ).rejects.toThrow(/is still running/);
    expect(await port.listNodes(source)).toHaveLength(4);
  });
});

describe("PgAssemblyLines resumeFrom", () => {
  const HASH = "hash-implementation";
  const AT = new Date("2026-08-07T10:00:00Z");

  function sourceRow(over: Record<string, unknown> = {}) {
    return {
      id: "src",
      definition_name: "implementation",
      task_id: "task-9",
      repo: "re-cinq/lore",
      branch: "lore/implementation/x",
      args: { spec: "specs/x/spec.md" },
      status: "failed",
      outcome: "error",
      reason: null,
      definition_hash: HASH,
      resumed_from_line_id: null,
      resumed_from_node_id: null,
      inherited_node_count: 0,
      created_at: AT,
      started_at: AT,
      finished_at: AT,
      ...over,
    };
  }

  function sourceNode(id: number, nodeId: string, iteration: number) {
    return {
      id,
      assembly_line_id: "src",
      node_id: nodeId,
      iteration,
      outcome: "success",
      agent_cr_name: `src12345678-${nodeId}`,
      commit_sha: `sha-${id}`,
      started_at: AT,
      finished_at: AT,
    };
  }

  const NODE_ROWS = [
    sourceNode(11, "implement", 1),
    sourceNode(12, "review", 1),
    sourceNode(13, "implement", 2),
  ];

  function resumeInput(over: Record<string, unknown> = {}) {
    return {
      definitionName: "implementation",
      repo: "re-cinq/lore",
      definitionHash: HASH,
      resumeFrom: { lineId: "src", nodeId: "review" },
      ...over,
    };
  }

  it("reads the source line and its nodes before writing anything", async () => {
    const { pool, calls } = fakePool([
      [sourceRow()],
      NODE_ROWS,
      [{ id: "al-9" }],
    ]);

    const id = await new PgAssemblyLines(pool).start(resumeInput());

    expect(id).toBe("al-9");
    expect(calls[0]?.text).toContain("FROM pipeline.assembly_lines");
    expect(calls[1]?.text).toContain("FROM pipeline.assembly_line_nodes");
    expect(calls).toHaveLength(3);
  });

  it("writes the line row, the start event and the copied node rows in one statement", async () => {
    const { pool, calls } = fakePool([
      [sourceRow()],
      NODE_ROWS,
      [{ id: "al-9" }],
    ]);

    await new PgAssemblyLines(pool).start(resumeInput());
    const sql = calls[2]?.text ?? "";

    expect(sql).toContain("INSERT INTO pipeline.assembly_lines");
    expect(sql).toContain("INSERT INTO pipeline.events");
    expect(sql).toContain("INSERT INTO pipeline.assembly_line_nodes");
    expect(sql).toContain("'assembly_line.start:' || al.id");
  });

  it("bounds the copy by the cutoff row id, scoped to the source line and ordered by id", async () => {
    const { pool, calls } = fakePool([
      [sourceRow()],
      NODE_ROWS,
      [{ id: "al-9" }],
    ]);

    await new PgAssemblyLines(pool).start(resumeInput());
    const sql = calls[2]?.text ?? "";

    expect(sql).toContain("WHERE n.assembly_line_id = $7");
    expect(sql).toContain("AND n.id <= $9::bigint");
    expect(sql).toContain("ORDER BY n.id");
    // cutoff is the LATEST completed "review" row — id 12, not the line's last row
    expect(calls[2]?.params?.[8]).toBe("12");
  });

  it("binds the inherited branch, taskId, args, hash and parentage", async () => {
    const { pool, calls } = fakePool([
      [sourceRow()],
      NODE_ROWS,
      [{ id: "al-9" }],
    ]);

    await new PgAssemblyLines(pool).start(resumeInput());

    expect(calls[2]?.params).toEqual([
      "implementation",
      "task-9",
      "re-cinq/lore",
      "lore/implementation/x",
      JSON.stringify({ spec: "specs/x/spec.md" }),
      HASH,
      "src",
      "review",
      "12",
      2,
    ]);
  });

  it("binds overridden args instead of the source's", async () => {
    const { pool, calls } = fakePool([
      [sourceRow()],
      NODE_ROWS,
      [{ id: "al-9" }],
    ]);

    await new PgAssemblyLines(pool).start(
      resumeInput({ args: { spec: "specs/y/spec.md" } }),
    );

    expect(calls[2]?.params?.[4]).toBe(
      JSON.stringify({ spec: "specs/y/spec.md" }),
    );
  });

  it("copies the source's outcome, commit sha and timestamps but nulls the agent CR name", async () => {
    const { pool, calls } = fakePool([
      [sourceRow()],
      NODE_ROWS,
      [{ id: "al-9" }],
    ]);

    await new PgAssemblyLines(pool).start(resumeInput());
    const sql = calls[2]?.text ?? "";

    expect(sql).toContain(
      "n.node_id, n.iteration, n.outcome, NULL, n.commit_sha, n.started_at, n.finished_at",
    );
  });

  it("issues no write when the source line is still running", async () => {
    const { pool, calls } = fakePool([[sourceRow({ status: "running" })], []]);

    await expect(
      new PgAssemblyLines(pool).start(resumeInput()),
    ).rejects.toThrow(/is still running/);
    expect(calls.every((c) => c.text.includes("SELECT"))).toBe(true);
  });

  it("issues no write when the definition hash drifted", async () => {
    const { pool, calls } = fakePool([
      [sourceRow({ definition_hash: "other" })],
      NODE_ROWS,
    ]);

    await expect(
      new PgAssemblyLines(pool).start(resumeInput()),
    ).rejects.toThrow(/has changed since that run/);
    expect(calls).toHaveLength(2);
  });

  it("binds {} when neither the input nor the source row carries args", async () => {
    const { pool, calls } = fakePool([
      [sourceRow({ args: null })],
      NODE_ROWS,
      [{ id: "al-9" }],
    ]);

    await new PgAssemblyLines(pool).start(resumeInput());

    expect(calls[2]?.params?.[4]).toBe(JSON.stringify({}));
  });

  it("keeps the plain start on its own two-CTE statement with five parameters", async () => {
    const { pool, calls } = fakePool([[{ id: "al-1" }]]);

    await new PgAssemblyLines(pool).start({
      definitionName: "general",
      repo: "re-cinq/lore",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.params).toHaveLength(5);
    expect(calls[0]?.text).not.toContain(
      "INSERT INTO pipeline.assembly_line_nodes",
    );
  });
});

describe("AssemblyLines facade resumeFrom", () => {
  it("passes resumeFrom and definitionHash through, filling the repo from its scope", async () => {
    const port = new InMemoryAssemblyLines();
    const facade = new AssemblyLines("re-cinq/lore", port);
    const source = await facade.start("general", { branch: "feat/x" });

    await port.stampDefinitionHash(source, "hash-general");
    await port.markRunning(source);
    const { nodeRowId } = await port.ensureNodeStart({
      assemblyLineId: source,
      nodeId: "work",
      iteration: 1,
    });

    await port.finishNodeOnce(nodeRowId, "success");
    await port.finish(source, "completed");

    const fork = await facade.start("general", {
      definitionHash: "hash-general",
      resumeFrom: { lineId: source, nodeId: "work" },
    });

    expect(await facade.getById(fork)).toMatchObject({
      repo: "re-cinq/lore",
      branch: "feat/x",
      resumedFromLineId: source,
    });
    expect(await port.listNodes(fork)).toHaveLength(1);
  });
});

describe("plain start agrees across the adapter and the double", () => {
  it("states an explicit null parentage in the event rather than omitting the key", async () => {
    const { pool, calls } = fakePool([[{ id: "al-1" }]]);
    const port = new InMemoryAssemblyLines();

    await new PgAssemblyLines(pool).start({
      definitionName: "general",
      repo: "re-cinq/lore",
    });
    await port.start({ definitionName: "general", repo: "re-cinq/lore" });

    expect(calls[0]?.text).toContain("'resumedFrom', NULL::jsonb");
    expect(port.events[0]?.params).toHaveProperty("resumedFrom", null);
  });

  it("stores no definition hash, because the caller's hash is a resume input the Floor re-stamps", async () => {
    const { pool, calls } = fakePool([[{ id: "al-1" }]]);
    const port = new InMemoryAssemblyLines();

    await new PgAssemblyLines(pool).start({
      definitionName: "general",
      repo: "re-cinq/lore",
      definitionHash: "hash-general",
    });
    const id = await port.start({
      definitionName: "general",
      repo: "re-cinq/lore",
      definitionHash: "hash-general",
    });

    expect(calls[0]?.text).not.toContain("definition_hash");
    expect(calls[0]?.params).not.toContain("hash-general");
    expect(await port.getById(id)).toMatchObject({ definitionHash: null });
  });
});

describe("AssemblyLinesPort mergeArgs", () => {
  it("adds a produced artifact to the line without disturbing what start() set", async () => {
    // How one node's output reaches the next: args are the line's shared channel,
    // and a node that produces a plan merges it in for the node that consumes it.
    const lines = new InMemoryAssemblyLines();
    const id = await lines.start({
      definitionName: "feature-finalize",
      repo: "re-cinq/lore",
      branch: "spec/x",
      args: { description: "the accepted plan" },
    });

    await lines.mergeArgs(id, { spec_plan: '{"changes":[]}' });

    expect((await lines.getById(id))?.args).toEqual({
      description: "the accepted plan",
      spec_plan: '{"changes":[]}',
    });
  });

  it("keeps earlier merges, so an objection joins the plan rather than replacing it", async () => {
    const lines = new InMemoryAssemblyLines();
    const id = await lines.start({
      definitionName: "feature-finalize",
      repo: "re-cinq/lore",
      args: { description: "d" },
    });

    await lines.mergeArgs(id, { spec_plan: "p" });
    await lines.mergeArgs(id, { write_objection: "path does not exist" });

    expect((await lines.getById(id))?.args).toMatchObject({
      description: "d",
      spec_plan: "p",
      write_objection: "path does not exist",
    });
  });

  it("overwrites a key a re-run replaces, so a stale objection cannot survive", async () => {
    // The upstream node re-runs after an objection; its NEW output must win, or the
    // consumer would read the plan that was already rejected.
    const lines = new InMemoryAssemblyLines();
    const id = await lines.start({
      definitionName: "feature-finalize",
      repo: "re-cinq/lore",
      args: {},
    });

    await lines.mergeArgs(id, { spec_plan: "first" });
    await lines.mergeArgs(id, { spec_plan: "second" });

    expect((await lines.getById(id))?.args).toEqual({ spec_plan: "second" });
  });

  it("is a no-op for a line that does not exist", async () => {
    const lines = new InMemoryAssemblyLines();

    await expect(
      lines.mergeArgs("00000000-0000-0000-0000-000000000000", { a: 1 }),
    ).resolves.toBeUndefined();
  });
});
