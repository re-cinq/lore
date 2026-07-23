import { describe, it, expect } from "vitest";
import { InMemoryAgentRunEvents } from "./agent-run-events-memory.js";
import { PgAgentRunEvents } from "./agent-run-events-pg.js";
import type { AgentRunEventInsert } from "./agent-run-events-port.js";
import type { PgPool } from "../../memory-store.js";

function insert(
  overrides: Partial<AgentRunEventInsert> = {},
): AgentRunEventInsert {
  return {
    taskId: "task-1",
    agentCrName: "a1b2c3d4-implement",
    eventType: "tool_call",
    ...overrides,
  };
}

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

describe("InMemoryAgentRunEvents insertBatch", () => {
  it("correlates a row to the newest assembly_line_nodes row matching agent_cr_name", async () => {
    const repo = new InMemoryAgentRunEvents();

    repo.registerNode({
      agentCrName: "a1b2c3d4-implement",
      assemblyLineId: "line-1",
      nodeId: "implement",
      iteration: 1,
    });
    repo.registerNode({
      agentCrName: "a1b2c3d4-implement",
      assemblyLineId: "line-1",
      nodeId: "implement",
      iteration: 2,
    });

    const [row] = await repo.insertBatch([insert()]);

    expect(row).toMatchObject({
      assemblyLineId: "line-1",
      nodeId: "implement",
      iteration: 2,
    });
  });

  it("inserts the row with null assemblyLineId, nodeId and iteration when no node matches agent_cr_name", async () => {
    const repo = new InMemoryAgentRunEvents();

    const [row] = await repo.insertBatch([
      insert({ agentCrName: "task-scoped-cr" }),
    ]);

    expect(row).toMatchObject({
      assemblyLineId: null,
      nodeId: null,
      iteration: null,
    });
  });

  it("retains agentCrName on an uncorrelated row", async () => {
    const repo = new InMemoryAgentRunEvents();

    const [row] = await repo.insertBatch([
      insert({ agentCrName: "task-scoped-cr" }),
    ]);

    expect(row.agentCrName).toBe("task-scoped-cr");
  });

  it("returns id as a string for every inserted row", async () => {
    const repo = new InMemoryAgentRunEvents();

    const rows = await repo.insertBatch([insert(), insert(), insert()]);

    expect(rows.map((row) => typeof row.id)).toEqual([
      "string",
      "string",
      "string",
    ]);
  });

  it("returns rows carrying every field named in the canonical contract", async () => {
    const repo = new InMemoryAgentRunEvents({
      now: () => new Date("2026-07-20T10:00:00.000Z"),
    });

    repo.registerNode({
      agentCrName: "a1b2c3d4-implement",
      assemblyLineId: "line-1",
      nodeId: "implement",
      iteration: 1,
    });

    const [row] = await repo.insertBatch([
      insert({
        toolName: "Edit",
        toolUseId: "toolu_01",
        isError: true,
        filePaths: ["src/a.ts"],
        summary: "Edit src/a.ts",
        payload: { name: "Edit" },
      }),
    ]);

    expect(row).toEqual({
      id: "1",
      taskId: "task-1",
      agentCrName: "a1b2c3d4-implement",
      assemblyLineId: "line-1",
      nodeId: "implement",
      iteration: 1,
      eventType: "tool_call",
      toolName: "Edit",
      toolUseId: "toolu_01",
      isError: true,
      filePaths: ["src/a.ts"],
      summary: "Edit src/a.ts",
      payload: { name: "Edit" },
      createdAt: new Date("2026-07-20T10:00:00.000Z"),
    });
  });

  it("defaults isError to false, filePaths to empty and payload to empty on a minimal insert", async () => {
    const repo = new InMemoryAgentRunEvents();

    const [row] = await repo.insertBatch([insert()]);

    expect(row).toMatchObject({
      isError: false,
      filePaths: [],
      payload: {},
      toolName: null,
      toolUseId: null,
      summary: null,
    });
  });

  it("inserts the remaining rows of a batch when one row correlates to nothing", async () => {
    const repo = new InMemoryAgentRunEvents();

    repo.registerNode({
      agentCrName: "a1b2c3d4-implement",
      assemblyLineId: "line-1",
      nodeId: "implement",
      iteration: 1,
    });

    const rows = await repo.insertBatch([
      insert({ agentCrName: "unknown-cr" }),
      insert(),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.assemblyLineId)).toEqual([null, "line-1"]);
  });

  it("returns an empty array for an empty batch", async () => {
    const repo = new InMemoryAgentRunEvents();

    expect(await repo.insertBatch([])).toEqual([]);
  });
});

describe("InMemoryAgentRunEvents listSince", () => {
  async function seededLine(): Promise<InMemoryAgentRunEvents> {
    const repo = new InMemoryAgentRunEvents();

    repo.registerNode({
      agentCrName: "cr-a",
      assemblyLineId: "line-1",
      nodeId: "implement",
      iteration: 1,
    });
    repo.registerNode({
      agentCrName: "cr-b",
      assemblyLineId: "line-2",
      nodeId: "implement",
      iteration: 1,
    });
    await repo.insertBatch([
      insert({ agentCrName: "cr-a" }),
      insert({ agentCrName: "cr-a" }),
      insert({ agentCrName: "cr-b" }),
      insert({ agentCrName: "cr-a" }),
    ]);

    return repo;
  }

  it("returns rows ascending by id", async () => {
    const repo = await seededLine();

    const rows = await repo.listSince("line-1", "0", 10);

    expect(rows.map((row) => row.id)).toEqual(["1", "2", "4"]);
  });

  it("excludes rows at or below afterId", async () => {
    const repo = await seededLine();

    const rows = await repo.listSince("line-1", "2", 10);

    expect(rows.map((row) => row.id)).toEqual(["4"]);
  });

  it("excludes rows belonging to another assembly line", async () => {
    const repo = await seededLine();

    const rows = await repo.listSince("line-2", "0", 10);

    expect(rows.map((row) => row.id)).toEqual(["3"]);
  });

  it("returns at most limit rows", async () => {
    const repo = await seededLine();

    const rows = await repo.listSince("line-1", "0", 2);

    expect(rows.map((row) => row.id)).toEqual(["1", "2"]);
  });

  it("paging over two calls returns no gap and no duplicate", async () => {
    const repo = await seededLine();

    const first = await repo.listSince("line-1", "0", 2);
    const second = await repo.listSince(
      "line-1",
      first[first.length - 1].id,
      2,
    );

    expect([...first, ...second].map((row) => row.id)).toEqual(["1", "2", "4"]);
  });

  it("compares the cursor numerically rather than lexicographically", async () => {
    const repo = new InMemoryAgentRunEvents();

    repo.registerNode({
      agentCrName: "cr-a",
      assemblyLineId: "line-1",
      nodeId: "implement",
      iteration: 1,
    });
    await repo.insertBatch(
      Array.from({ length: 11 }, () => insert({ agentCrName: "cr-a" })),
    );

    const rows = await repo.listSince("line-1", "9", 10);

    expect(rows.map((row) => row.id)).toEqual(["10", "11"]);
  });
});

describe("InMemoryAgentRunEvents pruneOld", () => {
  it("deletes rows older than the horizon and returns the deleted count", async () => {
    let clock = new Date("2026-07-01T00:00:00.000Z");
    const repo = new InMemoryAgentRunEvents({ now: () => clock });

    await repo.insertBatch([insert(), insert()]);
    clock = new Date("2026-07-20T00:00:00.000Z");
    await repo.insertBatch([insert()]);

    expect(await repo.pruneOld(14)).toBe(2);
    expect(repo.rows.map((row) => row.id)).toEqual(["3"]);
  });

  it("keeps rows inside the horizon", async () => {
    let clock = new Date("2026-07-10T00:00:00.000Z");
    const repo = new InMemoryAgentRunEvents({ now: () => clock });

    await repo.insertBatch([insert()]);
    clock = new Date("2026-07-20T00:00:00.000Z");

    expect(await repo.pruneOld(14)).toBe(0);
    expect(repo.rows).toHaveLength(1);
  });
});

describe("PgAgentRunEvents adapter", () => {
  it("insertBatch of an empty array returns an empty array and issues no query", async () => {
    const { pool, calls } = fakePool();

    expect(await new PgAgentRunEvents(pool).insertBatch([])).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("insertBatch correlates through a lateral join on the newest node row", async () => {
    const { pool, calls } = fakePool([[]]);

    await new PgAgentRunEvents(pool).insertBatch([insert()]);

    expect(calls[0]?.text).toContain("INSERT INTO pipeline.agent_run_events");
    expect(calls[0]?.text).toContain("LEFT JOIN LATERAL");
    expect(calls[0]?.text).toContain("node.agent_cr_name = v.agent_cr_name");
    expect(calls[0]?.text).toContain("ORDER BY node.id DESC");
    expect(calls[0]?.text).toContain("RETURNING *");
  });

  it("insertBatch passes the batch as a single jsonb parameter", async () => {
    const { pool, calls } = fakePool([[]]);

    await new PgAgentRunEvents(pool).insertBatch([
      insert({ filePaths: ["src/a.ts"], payload: { name: "Edit" } }),
    ]);

    expect(calls[0]?.params).toHaveLength(1);
    expect(JSON.parse(String(calls[0]?.params?.[0]))).toEqual([
      {
        task_id: "task-1",
        agent_cr_name: "a1b2c3d4-implement",
        event_type: "tool_call",
        tool_name: null,
        tool_use_id: null,
        is_error: false,
        file_paths: ["src/a.ts"],
        summary: null,
        payload: { name: "Edit" },
      },
    ]);
  });

  it("insertBatch maps a bigint id to a string and returns rows ascending by id", async () => {
    const { pool } = fakePool([
      [
        {
          id: "9007199254740995",
          task_id: "task-1",
          agent_cr_name: "cr-a",
          assembly_line_id: "line-1",
          node_id: "implement",
          iteration: 2,
          event_type: "tool_result",
          tool_name: "Edit",
          tool_use_id: "toolu_01",
          is_error: false,
          file_paths: ["src/a.ts"],
          summary: "Edit src/a.ts",
          payload: { ok: true },
          created_at: new Date("2026-07-20T10:00:00.000Z"),
        },
        {
          id: "9007199254740994",
          task_id: "task-1",
          agent_cr_name: null,
          assembly_line_id: null,
          node_id: null,
          iteration: null,
          event_type: "message",
          tool_name: null,
          tool_use_id: null,
          is_error: false,
          file_paths: [],
          summary: null,
          payload: {},
          created_at: new Date("2026-07-20T09:00:00.000Z"),
        },
      ],
    ]);

    const rows = await new PgAgentRunEvents(pool).insertBatch([insert()]);

    expect(rows.map((row) => row.id)).toEqual([
      "9007199254740994",
      "9007199254740995",
    ]);
    expect(rows[1]).toEqual({
      id: "9007199254740995",
      taskId: "task-1",
      agentCrName: "cr-a",
      assemblyLineId: "line-1",
      nodeId: "implement",
      iteration: 2,
      eventType: "tool_result",
      toolName: "Edit",
      toolUseId: "toolu_01",
      isError: false,
      filePaths: ["src/a.ts"],
      summary: "Edit src/a.ts",
      payload: { ok: true },
      createdAt: new Date("2026-07-20T10:00:00.000Z"),
    });
  });

  it("listSince filters by line and cursor with an ascending capped read", async () => {
    const { pool, calls } = fakePool([[]]);

    await new PgAgentRunEvents(pool).listSince("line-1", "42", 500);

    expect(calls[0]?.text).toContain("assembly_line_id = $1");
    expect(calls[0]?.text).toContain("id > $2::bigint");
    expect(calls[0]?.text).toContain("ORDER BY id ASC");
    expect(calls[0]?.text).toContain("LIMIT $3");
    expect(calls[0]?.params).toEqual(["line-1", "42", 500]);
  });

  it("pruneOld deletes by day horizon and returns the count", async () => {
    const { pool, calls } = fakePool([[{ count: 7 }]]);

    expect(await new PgAgentRunEvents(pool).pruneOld(14)).toBe(7);
    expect(calls[0]?.text).toContain("DELETE FROM pipeline.agent_run_events");
    expect(calls[0]?.text).toContain("make_interval(days => $1)");
    expect(calls[0]?.params).toEqual([14]);
  });
});

describe("InMemoryAgentRunEvents cross-line CR-name collision", () => {
  it("attributes the event to the newest node row when two lines collide on agent_cr_name (#907)", async () => {
    // Two DIFFERENT assembly lines whose uuids share their 12-hex prefix run
    // the same node at the same iteration, producing identical CR names.
    const repo = new InMemoryAgentRunEvents();

    repo.registerNode({
      agentCrName: "a1b2c3d4e5f6-implement",
      assemblyLineId: "a1b2c3d4-e5f6-4000-8000-000000000001",
      nodeId: "implement",
      iteration: 1,
    });
    repo.registerNode({
      agentCrName: "a1b2c3d4e5f6-implement",
      assemblyLineId: "a1b2c3d4-e5f6-4000-8000-000000000002",
      nodeId: "implement",
      iteration: 1,
    });

    const [row] = await repo.insertBatch([
      insert({ agentCrName: "a1b2c3d4e5f6-implement" }),
    ]);

    expect(row).toMatchObject({
      assemblyLineId: "a1b2c3d4-e5f6-4000-8000-000000000002",
      nodeId: "implement",
      iteration: 1,
    });
  });
});
