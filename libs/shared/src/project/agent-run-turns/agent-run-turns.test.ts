import { describe, it, expect } from "vitest";
import { InMemoryAgentRunTurns } from "./agent-run-turns-memory.js";
import { PgAgentRunTurns } from "./agent-run-turns-pg.js";
import {
  compareTurnIdAscending,
  type AgentRunTurnInsert,
  type AgentRunTurnRow,
} from "./agent-run-turns-port.js";
import type { PgPool } from "../../memory-store.js";

function turn(overrides: Partial<AgentRunTurnInsert> = {}): AgentRunTurnInsert {
  return {
    taskId: "task-1",
    agentCrName: "a1b2c3d4-implement",
    eventType: "assistant",
    envelope: '{"source":{"task":"task-1"},"event":{"type":"assistant"}}',
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

describe("InMemoryAgentRunTurns insertBatch", () => {
  it("correlates a turn to the newest assembly_line_nodes row matching agent_cr_name", async () => {
    const repo = new InMemoryAgentRunTurns();

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

    const [row] = await repo.insertBatch([turn()]);

    expect(row).toMatchObject({
      assemblyLineId: "line-1",
      nodeId: "implement",
      iteration: 2,
    });
  });

  it("keeps a turn whose agent_cr_name matches no node, with null correlation and the name retained", async () => {
    const repo = new InMemoryAgentRunTurns();

    const [row] = await repo.insertBatch([
      turn({ agentCrName: "task-scoped-cr" }),
    ]);

    expect(row).toMatchObject({
      agentCrName: "task-scoped-cr",
      assemblyLineId: null,
      nodeId: null,
      iteration: null,
    });
  });

  it("inserts the remaining turns of a batch when one turn correlates to nothing", async () => {
    const repo = new InMemoryAgentRunTurns();

    repo.registerNode({
      agentCrName: "a1b2c3d4-implement",
      assemblyLineId: "line-1",
      nodeId: "implement",
      iteration: 1,
    });

    const rows = await repo.insertBatch([
      turn({ agentCrName: "unknown-cr" }),
      turn(),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.assemblyLineId)).toEqual([null, "line-1"]);
  });

  it("stores a turn carrying no task id rather than dropping it", async () => {
    const repo = new InMemoryAgentRunTurns();

    const [row] = await repo.insertBatch([
      turn({ taskId: null, agentCrName: null }),
    ]);

    expect(row).toMatchObject({ taskId: null, agentCrName: null });
  });

  it("returns the envelope untruncated and parsed from its JSON text", async () => {
    const content = "x".repeat(50_000);
    const repo = new InMemoryAgentRunTurns({
      now: () => new Date("2026-08-07T10:00:00.000Z"),
    });

    const [row] = await repo.insertBatch([
      turn({ envelope: JSON.stringify({ event: { content } }) }),
    ]);

    expect(row).toEqual({
      id: "1",
      taskId: "task-1",
      agentCrName: "a1b2c3d4-implement",
      assemblyLineId: null,
      nodeId: null,
      iteration: null,
      eventType: "assistant",
      envelope: { event: { content } },
      createdAt: new Date("2026-08-07T10:00:00.000Z"),
    });
  });

  it("returns id as a string for every inserted turn", async () => {
    const repo = new InMemoryAgentRunTurns();

    const rows = await repo.insertBatch([turn(), turn(), turn()]);

    expect(rows.map((row) => typeof row.id)).toEqual([
      "string",
      "string",
      "string",
    ]);
  });

  it("returns an empty array for an empty batch", async () => {
    const repo = new InMemoryAgentRunTurns();

    expect(await repo.insertBatch([])).toEqual([]);
  });
});

describe("InMemoryAgentRunTurns reads", () => {
  async function seeded(): Promise<InMemoryAgentRunTurns> {
    const repo = new InMemoryAgentRunTurns();

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
      turn({ agentCrName: "cr-a" }),
      turn({ agentCrName: "cr-a" }),
      turn({ agentCrName: "cr-b", taskId: "task-2" }),
      turn({ agentCrName: "cr-a" }),
    ]);

    return repo;
  }

  it("listByLine returns one line's turns ascending by id, excluding other lines", async () => {
    const repo = await seeded();

    const rows = await repo.listByLine("line-1", "0", 10);

    expect(rows.map((row) => row.id)).toEqual(["1", "2", "4"]);
  });

  it("listByLine excludes turns at or below the cursor and caps at the limit", async () => {
    const repo = await seeded();

    expect((await repo.listByLine("line-1", "2", 10)).map((r) => r.id)).toEqual(
      ["4"],
    );
    expect((await repo.listByLine("line-1", "0", 2)).map((r) => r.id)).toEqual([
      "1",
      "2",
    ]);
  });

  it("listByLine paging over two calls returns no gap and no duplicate", async () => {
    const repo = await seeded();

    const first = await repo.listByLine("line-1", "0", 2);
    const second = await repo.listByLine(
      "line-1",
      first[first.length - 1].id,
      2,
    );

    expect([...first, ...second].map((row) => row.id)).toEqual(["1", "2", "4"]);
  });

  it("listByLine compares the cursor numerically rather than lexicographically", async () => {
    const repo = new InMemoryAgentRunTurns();

    repo.registerNode({
      agentCrName: "cr-a",
      assemblyLineId: "line-1",
      nodeId: "implement",
      iteration: 1,
    });
    await repo.insertBatch(
      Array.from({ length: 11 }, () => turn({ agentCrName: "cr-a" })),
    );

    const rows = await repo.listByLine("line-1", "9", 10);

    expect(rows.map((row) => row.id)).toEqual(["10", "11"]);
  });

  it("listByTask reaches the turns that correlate to no assembly line", async () => {
    const repo = new InMemoryAgentRunTurns();

    await repo.insertBatch([
      turn({ agentCrName: "unknown-cr" }),
      turn({ agentCrName: "unknown-cr", taskId: "task-2" }),
    ]);

    const rows = await repo.listByTask("task-1", "0", 10);

    expect(rows.map((row) => row.id)).toEqual(["1"]);
  });
});

describe("InMemoryAgentRunTurns pruneOld", () => {
  it("deletes turns older than the horizon and returns the deleted count", async () => {
    let clock = new Date("2026-05-01T00:00:00.000Z");
    const repo = new InMemoryAgentRunTurns({ now: () => clock });

    await repo.insertBatch([turn(), turn()]);
    clock = new Date("2026-08-07T00:00:00.000Z");
    await repo.insertBatch([turn()]);

    expect(await repo.pruneOld(30)).toBe(2);
    expect(repo.rows.map((row) => row.id)).toEqual(["3"]);
  });

  it("keeps turns inside the horizon", async () => {
    let clock = new Date("2026-08-01T00:00:00.000Z");
    const repo = new InMemoryAgentRunTurns({ now: () => clock });

    await repo.insertBatch([turn()]);
    clock = new Date("2026-08-07T00:00:00.000Z");

    expect(await repo.pruneOld(30)).toBe(0);
    expect(repo.rows).toHaveLength(1);
  });
});

describe("PgAgentRunTurns adapter", () => {
  it("insertBatch of an empty array returns an empty array and issues no query", async () => {
    const { pool, calls } = fakePool();

    expect(await new PgAgentRunTurns(pool).insertBatch([])).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("insertBatch correlates through a lateral join on the newest node row", async () => {
    const { pool, calls } = fakePool([[]]);

    await new PgAgentRunTurns(pool).insertBatch([turn()]);

    expect(calls[0]?.text).toContain("INSERT INTO pipeline.agent_run_turns");
    expect(calls[0]?.text).toContain("LEFT JOIN LATERAL");
    expect(calls[0]?.text).toContain("node.agent_cr_name = v.agent_cr_name");
    expect(calls[0]?.text).toContain("ORDER BY node.id DESC");
    expect(calls[0]?.text).toContain("RETURNING *");
  });

  it("insertBatch passes the whole batch as a single bound jsonb parameter", async () => {
    const { pool, calls } = fakePool([[]]);
    const envelope = '{"event":{"text":"$1; DROP TABLE pipeline.tasks --"}}';

    await new PgAgentRunTurns(pool).insertBatch([turn({ envelope })]);

    expect(calls[0]?.text).toContain("jsonb_to_recordset($1::jsonb)");
    expect(calls[0]?.text).not.toContain("DROP TABLE");
    expect(calls[0]?.params).toHaveLength(1);
    expect(JSON.parse(String(calls[0]?.params?.[0]))).toEqual([
      {
        task_id: "task-1",
        agent_cr_name: "a1b2c3d4-implement",
        event_type: "assistant",
        envelope,
      },
    ]);
  });

  it("insertBatch casts the envelope from bound text to jsonb inside the statement", async () => {
    const { pool, calls } = fakePool([[]]);

    await new PgAgentRunTurns(pool).insertBatch([turn()]);

    expect(calls[0]?.text).toContain("envelope TEXT");
    expect(calls[0]?.text).toContain("v.envelope::jsonb");
  });

  it("insertBatch maps a bigint id to a string and returns turns ascending by id", async () => {
    const { pool } = fakePool([
      [
        {
          id: "9007199254740995",
          task_id: "task-1",
          agent_cr_name: "cr-a",
          assembly_run_id: "line-1",
          node_id: "implement",
          iteration: 2,
          event_type: "assistant",
          envelope: { event: { type: "assistant" } },
          created_at: new Date("2026-08-07T10:00:00.000Z"),
        },
        {
          id: "9007199254740994",
          task_id: null,
          agent_cr_name: null,
          assembly_run_id: null,
          node_id: null,
          iteration: null,
          event_type: null,
          envelope: {},
          created_at: new Date("2026-08-07T09:00:00.000Z"),
        },
      ],
    ]);

    const rows = await new PgAgentRunTurns(pool).insertBatch([turn()]);

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
      eventType: "assistant",
      envelope: { event: { type: "assistant" } },
      createdAt: new Date("2026-08-07T10:00:00.000Z"),
    });
  });

  it("listByLine filters by line and cursor with an ascending capped read", async () => {
    const { pool, calls } = fakePool([[]]);

    await new PgAgentRunTurns(pool).listByLine("line-1", "42", 500);

    expect(calls[0]?.text).toContain("assembly_run_id = $1");
    expect(calls[0]?.text).toContain("id > $2::bigint");
    expect(calls[0]?.text).toContain("ORDER BY id ASC");
    expect(calls[0]?.text).toContain("LIMIT $3");
    expect(calls[0]?.params).toEqual(["line-1", "42", 500]);
  });

  it("listByTask filters by task and cursor with an ascending capped read", async () => {
    const { pool, calls } = fakePool([[]]);

    await new PgAgentRunTurns(pool).listByTask("task-1", "42", 500);

    expect(calls[0]?.text).toContain("task_id = $1");
    expect(calls[0]?.text).toContain("id > $2::bigint");
    expect(calls[0]?.text).toContain("ORDER BY id ASC");
    expect(calls[0]?.params).toEqual(["task-1", "42", 500]);
  });

  it("pruneOld deletes by day horizon and returns the count", async () => {
    const { pool, calls } = fakePool([[{ count: 7 }]]);

    expect(await new PgAgentRunTurns(pool).pruneOld(30)).toBe(7);
    expect(calls[0]?.text).toContain("DELETE FROM pipeline.agent_run_turns");
    expect(calls[0]?.text).toContain("make_interval(days => $1)");
    expect(calls[0]?.params).toEqual([30]);
  });
});

describe("compareTurnIdAscending", () => {
  // Both adapters sort with this one comparator. Array#sort's behaviour for a
  // comparator that never returns 0 is implementation-defined — V8 happens to
  // mask it today, so the contract has to be asserted directly rather than
  // through insertBatch, which would pass either way.
  const at = (id: string): AgentRunTurnRow => ({
    id,
    taskId: null,
    agentCrName: null,
    assemblyLineId: null,
    nodeId: null,
    iteration: null,
    eventType: null,
    envelope: {},
    createdAt: new Date(0),
  });

  it("returns 0 for two rows carrying the same id", () => {
    expect(compareTurnIdAscending(at("42"), at("42"))).toBe(0);
  });

  it("returns a negative number when the left id is the smaller bigint", () => {
    expect(
      compareTurnIdAscending(at("9007199254740994"), at("9007199254740995")),
    ).toBeLessThan(0);
  });

  it("returns a positive number when the left id is the larger bigint", () => {
    expect(
      compareTurnIdAscending(at("9007199254740995"), at("9007199254740994")),
    ).toBeGreaterThan(0);
  });

  it("orders by numeric value rather than by string order", () => {
    expect(compareTurnIdAscending(at("10"), at("9"))).toBeGreaterThan(0);
  });
});
