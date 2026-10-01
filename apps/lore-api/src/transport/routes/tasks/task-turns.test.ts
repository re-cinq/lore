import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../app/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const TASK_SCOPED = { authorization: "Bearer task-only" };
const TASK_ID = "0b7e3f7e-1111-4222-8333-444455556666";
const originalEnv = { ...process.env };

const TURN_INSERT = "INSERT INTO pipeline.agent_run_turns";
let lastPool: ReturnType<typeof makePool>;

const taskPool = () => {
  const pool = makePool();

  pool.query.mockImplementation(async (sql: unknown) =>
    String(sql).includes(TURN_INSERT)
      ? { rows: [] }
      : { rows: [{ id: TASK_ID }] },
  );
  lastPool = pool;

  return pool;
};

const storedBatches = (pool = lastPool) =>
  pool.query.mock.calls
    .filter(([sql]) => String(sql).includes(TURN_INSERT))
    .map(
      ([, params]) =>
        JSON.parse((params as string[])[0]) as Array<{
          task_id: string;
          agent_cr_name: null;
          event_type: string | null;
          envelope: string;
          dedup_key: string;
        }>,
    );

const sent = () =>
  (storedBatches().at(-1) ?? []).map((row) => JSON.parse(row.envelope));

const post = (
  payload: string,
  pool: unknown = taskPool(),
  headers: Record<string, string> = AUTH,
  taskId: string = TASK_ID,
) =>
  buildServer(() => pool as any).inject({
    method: "POST",
    url: `/api/task-turns/${taskId}`,
    payload,
    headers,
  });

describe("POST /api/task-turns/{taskId}", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("wraps each line in the task attribution envelope and stores it in the turn store, keyed by the task", async () => {
    const lines = [
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({ type: "assistant", message: { content: "hi" } }),
      JSON.stringify({ type: "result", is_error: false, result: "done" }),
    ];
    const res = await post(lines.join("\n"));

    expect(res.result).toEqual({ forwarded: 3, skipped: 0 });
    expect(storedBatches()[0].map((row) => row.task_id)).toEqual([
      TASK_ID,
      TASK_ID,
      TASK_ID,
    ]);
    expect(sent()).toEqual(
      lines.map((l) => ({
        source: {
          task: TASK_ID,
          turn_key: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
        event: JSON.parse(l),
      })),
    );
  });

  it("skips non-JSON lines, file-kind events, and pre-attributed envelopes", async () => {
    const good = JSON.stringify({ type: "assistant" });
    const payload = [
      "--- VALIDATION FAILED ---",
      JSON.stringify({ kind: "file", path: "x", task: "spoof" }),
      JSON.stringify({ source: { agent: "forged-cr" }, event: { type: "x" } }),
      good,
      "",
    ].join("\n");
    const res = await post(payload);

    expect(res.result).toEqual({ forwarded: 1, skipped: 3 });
    expect(sent()[0]).toMatchObject({
      source: { task: TASK_ID },
      event: JSON.parse(good),
    });
  });

  it("skips a JSON line that parses to null or an array, not just an object", async () => {
    const good = JSON.stringify({ type: "assistant" });
    const payload = ["null", "[1,2,3]", good].join("\n");
    const res = await post(payload);

    expect(res.result).toEqual({ forwarded: 1, skipped: 2 });
  });

  it("returns 200 and stores nothing when no line survives filtering", async () => {
    const res = await post("not json at all");

    expect(res.result).toEqual({ forwarded: 0, skipped: 1 });
    expect(storedBatches()).toEqual([]);
  });

  it("stores each turn under its event type, with its key as the dedup key", async () => {
    await post(JSON.stringify({ type: "assistant" }));
    const [row] = storedBatches()[0];

    expect({ type: row.event_type, agent: row.agent_cr_name }).toEqual({
      type: "assistant",
      agent: null,
    });
    expect(row.dedup_key).toBe(sent()[0].source.turn_key);
  });

  it("returns 404 when the task does not exist", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({ rows: [] });
    const res = await post(JSON.stringify({ type: "assistant" }), pool);

    expect(res.statusCode).toBe(404);
    expect(storedBatches(pool)).toEqual([]);
  });

  it("returns 503 when no pool is available", async () => {
    const res = await post(JSON.stringify({ type: "assistant" }), null);

    expect(res.statusCode).toBe(503);
  });

  it("returns 400 when taskId is not a uuid", async () => {
    const res = await post(
      JSON.stringify({ type: "assistant" }),
      taskPool(),
      AUTH,
      "not-a-uuid",
    );

    expect(res.statusCode).toBe(400);
  });

  it("returns 403 when the token has task scope but not write", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({ rows: [{ scopes: ["task"] }] });
    const res = await post(
      JSON.stringify({ type: "assistant" }),
      pool,
      TASK_SCOPED,
    );

    expect(res.statusCode).toBe(403);
  });
});

describe("POST /api/task-turns turn_key stamping — re-ingest dedup (#1389)", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  const L1 = JSON.stringify({ type: "system", subtype: "init" });
  const L2 = JSON.stringify({ type: "assistant" });

  const sentKeys = () =>
    sent().map((envelope) => envelope.source.turn_key as string);

  it("stamps the same keys when the same body is retried", async () => {
    await post([L1, L2].join("\n"));
    const first = sentKeys();

    await post([L1, L2].join("\n"));
    const second = sentKeys();

    expect(first).toHaveLength(2);
    expect(first.every((key) => /^[0-9a-f]{64}$/.test(key))).toBe(true);
    expect(first[0]).not.toBe(first[1]);
    expect(second).toEqual(first);
  });

  it("keys byte-identical lines within one POST apart", async () => {
    await post([L2, L2].join("\n"));
    const keys = sentKeys();

    expect(keys[0]).not.toBe(keys[1]);
  });

  it("keys a line by its x-turn-offset position so a tail-only re-POST reproduces its key", async () => {
    await post([L1, L2].join("\n"), taskPool(), {
      ...AUTH,
      "x-turn-offset": "0",
    });
    const wholeBuffer = sentKeys();

    await post(L2, taskPool(), { ...AUTH, "x-turn-offset": "1" });

    expect(wholeBuffer[1]).toMatch(/^[0-9a-f]{64}$/);
    expect(sentKeys()).toEqual([wholeBuffer[1]]);
  });

  it("keys byte-identical lines apart under an offset header too", async () => {
    await post([L2, L2].join("\n"), taskPool(), {
      ...AUTH,
      "x-turn-offset": "5",
    });
    const keys = sentKeys();

    expect(keys[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("keys identical lines under different tasks apart", async () => {
    const OTHER_TASK = "1b7e3f7e-1111-4222-8333-444455556666";

    await post(L1);
    const first = sentKeys();

    await post(L1, taskPool(), AUTH, OTHER_TASK);

    expect(sentKeys()).not.toEqual(first);
  });

  it("falls back to per-POST occurrence keying when the offset header is not a number", async () => {
    const res = await post([L2, L2].join("\n"), taskPool(), {
      ...AUTH,
      "x-turn-offset": "banana",
    });
    const keys = sentKeys();

    expect(res.statusCode).toBe(200);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });
});
