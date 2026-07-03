import { describe, it, expect } from "vitest";
import { PgAssemblyLines } from "./assembly-lines-pg.js";
import { InMemoryAssemblyLines } from "./assembly-lines-memory.js";
import { AssemblyLines } from "./assembly-lines.js";
import type { PgPool } from "../../memory-store.js";

function fakePool(
  rowsByCall: unknown[][] = [],
): { pool: PgPool; calls: Array<{ text: string; params?: unknown[] }> } {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  const pool: PgPool = {
    async query(text: string, params?: unknown[]) {
      calls.push({ text, params });
      return { rows: rowsByCall[calls.length - 1] ?? [] };
    },
  };
  return { pool, calls };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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

    expect(calls[0]?.params).toEqual(["gap-fill", null, "re-cinq/lore", null, "{}"]);
  });

  it("record inserts the row with the caller-minted id and writes no event", async () => {
    const { pool, calls } = fakePool();

    await new PgAssemblyLines(pool).record({
      id: "11111111-2222-4333-8444-555555555555",
      definitionName: "implementation",
      repo: "re-cinq/lore",
    });

    expect(calls).toHaveLength(1);
    const sql = calls[0]?.text ?? "";
    expect(sql).toContain("INSERT INTO pipeline.assembly_lines");
    expect(sql).not.toContain("pipeline.events");
    expect(calls[0]?.params?.[0]).toBe("11111111-2222-4333-8444-555555555555");
  });

  it("markRunning stamps status running and started_at", async () => {
    const { pool, calls } = fakePool();

    await new PgAssemblyLines(pool).markRunning("al-1");

    expect(calls[0]?.text).toContain("status = 'running'");
    expect(calls[0]?.text).toContain("started_at = now()");
    expect(calls[0]?.params).toEqual(["al-1"]);
  });

  it("finish stamps status finished with outcome and finished_at", async () => {
    const { pool, calls } = fakePool();

    await new PgAssemblyLines(pool).finish("al-1", "pr_created");

    expect(calls[0]?.text).toContain("CASE WHEN $1 = 'error' THEN 'failed' ELSE 'finished' END");
    expect(calls[0]?.text).toContain("finished_at = now()");
    expect(calls[0]?.params).toEqual(["pr_created", null, "al-1"]);
  });

  it("finish with outcome error records the reason", async () => {
    const { pool, calls } = fakePool();

    await new PgAssemblyLines(pool).finish("al-1", "error", "lease held by other pod");

    expect(calls[0]?.params).toEqual(["error", "lease held by other pod", "al-1"]);
  });

  it("recordNodeStart inserts the node row and returns its id", async () => {
    const { pool, calls } = fakePool([[{ id: "42" }]]);

    const nodeRowId = await new PgAssemblyLines(pool).recordNodeStart({
      assemblyLineId: "al-1",
      nodeId: "implement",
      iteration: 1,
      agentCrName: "al1abcde-implement",
    });

    expect(nodeRowId).toBe("42");
    expect(calls[0]?.text).toContain("INSERT INTO pipeline.assembly_line_nodes");
    expect(calls[0]?.params).toEqual(["al-1", "implement", 1, "al1abcde-implement"]);
  });

  it("recordNodeStart without an agent CR name binds null", async () => {
    const { pool, calls } = fakePool([[{ id: 7 }]]);

    const nodeRowId = await new PgAssemblyLines(pool).recordNodeStart({
      assemblyLineId: "al-1",
      nodeId: "validate",
      iteration: 2,
    });

    expect(nodeRowId).toBe("7");
    expect(calls[0]?.params).toEqual(["al-1", "validate", 2, null]);
  });

  it("recordNodeFinish stamps outcome, commit sha, and finished_at", async () => {
    const { pool, calls } = fakePool();

    await new PgAssemblyLines(pool).recordNodeFinish("42", "success", "deadbeef");

    expect(calls[0]?.text).toContain("UPDATE pipeline.assembly_line_nodes");
    expect(calls[0]?.text).toContain("finished_at = now()");
    expect(calls[0]?.params).toEqual(["success", "deadbeef", "42"]);
  });

  it("recordNodeFinish without a commit sha binds null", async () => {
    const { pool, calls } = fakePool();

    await new PgAssemblyLines(pool).recordNodeFinish("42", "failed");

    expect(calls[0]?.params).toEqual(["failed", null, "42"]);
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
          id: "al-1", definition_name: "general", task_id: null, repo: "r/a", branch: null,
          args: null, status: "queued", outcome: null, reason: null,
          created_at: createdAt, started_at: null, finished_at: null,
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

  it("record seeds the row with the caller-minted id and no event", async () => {
    const assemblyLines = new InMemoryAssemblyLines();

    await assemblyLines.record({
      id: "11111111-2222-4333-8444-555555555555",
      definitionName: "gap-fill",
      repo: "re-cinq/lore",
    });

    expect(assemblyLines.rows).toMatchObject([
      { id: "11111111-2222-4333-8444-555555555555", status: "queued" },
    ]);
    expect(assemblyLines.events).toEqual([]);
  });

  it("markRunning transitions the matching row to running with started_at", async () => {
    const assemblyLines = new InMemoryAssemblyLines();
    const id = await assemblyLines.start({ definitionName: "general", repo: "re-cinq/lore" });

    await assemblyLines.markRunning(id);

    expect(assemblyLines.rows[0]).toMatchObject({ status: "running" });
    expect(assemblyLines.rows[0]?.startedAt).not.toBeNull();
  });

  it("finish with outcome pr_created closes the row as finished", async () => {
    const assemblyLines = new InMemoryAssemblyLines();
    const id = await assemblyLines.start({ definitionName: "general", repo: "re-cinq/lore" });

    await assemblyLines.finish(id, "pr_created");

    expect(assemblyLines.rows[0]).toMatchObject({ status: "finished", outcome: "pr_created", reason: null });
    expect(assemblyLines.rows[0]?.finishedAt).not.toBeNull();
  });

  it("finish with outcome error closes the row as failed with the reason", async () => {
    const assemblyLines = new InMemoryAssemblyLines();
    const id = await assemblyLines.start({ definitionName: "general", repo: "re-cinq/lore" });

    await assemblyLines.finish(id, "error", "iteration_max exceeded");

    expect(assemblyLines.rows[0]).toMatchObject({
      status: "failed",
      outcome: "error",
      reason: "iteration_max exceeded",
    });
  });

  it("recordNodeStart and recordNodeFinish trace one node execution", async () => {
    const assemblyLines = new InMemoryAssemblyLines();
    const id = await assemblyLines.start({ definitionName: "implementation", repo: "re-cinq/lore" });

    const nodeRowId = await assemblyLines.recordNodeStart({
      assemblyLineId: id,
      nodeId: "implement",
      iteration: 1,
      agentCrName: "al1abcde-implement",
    });
    await assemblyLines.recordNodeFinish(nodeRowId, "success", "deadbeef");

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

  it("recordNodeStart without an agent CR name stores null", async () => {
    const assemblyLines = new InMemoryAssemblyLines();
    const id = await assemblyLines.start({ definitionName: "general", repo: "re-cinq/lore" });

    const nodeRowId = await assemblyLines.recordNodeStart({
      assemblyLineId: id,
      nodeId: "validate",
      iteration: 1,
    });
    await assemblyLines.recordNodeFinish(nodeRowId, "failed");

    expect(assemblyLines.nodes[0]).toMatchObject({ agentCrName: null, commitSha: null, outcome: "failed" });
  });

  it("throws on unknown ids for markRunning, finish, and recordNodeFinish", async () => {
    const assemblyLines = new InMemoryAssemblyLines();

    await expect(assemblyLines.markRunning("nope")).rejects.toThrow(new Error('no assembly line "nope"'));
    await expect(assemblyLines.finish("nope", "error")).rejects.toThrow(new Error('no assembly line "nope"'));
    await expect(assemblyLines.recordNodeFinish("nope", "success")).rejects.toThrow(
      new Error('no assembly line node row "nope"'),
    );
  });

  it("getById returns the record and null for unknown ids", async () => {
    const assemblyLines = new InMemoryAssemblyLines();
    const id = await assemblyLines.start({ definitionName: "general", repo: "re-cinq/lore" });

    expect(await assemblyLines.getById(id)).toMatchObject({ id, definitionName: "general" });
    expect(await assemblyLines.getById("nope")).toBeNull();
  });

  it("listForTask returns only that task's assembly lines, newest first", async () => {
    const assemblyLines = new InMemoryAssemblyLines(() => new Date("2026-07-03T10:00:00Z"));
    const first = await assemblyLines.start({ definitionName: "general", repo: "r/a", taskId: "task-1" });
    assemblyLines.clock = () => new Date("2026-07-03T11:00:00Z");
    const second = await assemblyLines.start({ definitionName: "general", repo: "r/a", taskId: "task-1" });
    await assemblyLines.start({ definitionName: "general", repo: "r/a", taskId: "task-2" });

    const forTask = await assemblyLines.listForTask("task-1");

    expect(forTask.map((r) => r.id)).toEqual([second, first]);
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
});
