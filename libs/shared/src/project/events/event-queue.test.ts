import { describe, it, expect } from "vitest";
import { fakePgPool } from "../../test-helpers/fake-pg-pool.js";
import { PgEventQueue } from "./event-queue-pg.js";
import { InMemoryEventQueue } from "./event-queue-memory.js";
import type { EventRow } from "./event-queue-port.js";

describe("PgEventQueue.claimBatch", () => {
  it("claims runnable rows with FOR UPDATE SKIP LOCKED, incrementing attempts", async () => {
    const { pool, calls } = fakePgPool([{ rows: [{ id: "1" }] }]);
    const rows = await new PgEventQueue(pool).claimBatch(20);

    expect(rows).toEqual([{ id: "1" }]);
    expect(calls[0].text).toContain(
      "SET status = 'processing', attempts = attempts + 1",
    );
    expect(calls[0].text).toContain(
      "status IN ('pending', 'failed') AND next_attempt_at <= now()",
    );
    expect(calls[0].text).toContain("FOR UPDATE SKIP LOCKED");
    expect(calls[0].params).toEqual([20, []]);
  });

  it("excludes the passed event names from the claim so busy serial families stay pending", async () => {
    const { pool, calls } = fakePgPool([{ rows: [] }]);

    await new PgEventQueue(pool).claimBatch(20, ["internal.ingest.spec_trace"]);
    expect(calls[0].text).toContain("event_name <> ALL($2::text[])");
    expect(calls[0].params).toEqual([20, ["internal.ingest.spec_trace"]]);
  });
});

describe("PgEventQueue terminal transitions", () => {
  it("markFailed truncates the error and applies the backoff interval", async () => {
    const { pool, calls } = fakePgPool([{ rows: [] }]);

    await new PgEventQueue(pool).markFailed("7", "x".repeat(5000), 30);
    expect(calls[0].text).toContain("($3::int || ' seconds')::interval");
    expect((calls[0].params?.[1] as string).length).toBe(2000);
    expect(calls[0].params).toEqual(["7", "x".repeat(2000), 30]);
  });

  it("reapStuck returns the number of recovered rows", async () => {
    const { pool, calls } = fakePgPool([{ rows: [{ id: "1" }, { id: "2" }] }]);

    expect(await new PgEventQueue(pool).reapStuck(300)).toBe(2);
    expect(calls[0].text).toContain("WHERE status = 'processing'");
  });

  it("pruneHandled returns the number of deleted rows", async () => {
    const { pool, calls } = fakePgPool([{ rows: [{ id: "1" }] }]);

    expect(await new PgEventQueue(pool).pruneHandled(7)).toBe(1);
    expect(calls[0].text).toContain("DELETE FROM pipeline.events");
    expect(calls[0].text).toContain("status IN ('done', 'dead')");
  });
});

const NOW = Date.UTC(2026, 5, 30, 12, 0, 0);

describe("InMemoryEventQueue insert + claim", () => {
  it("collapses a redelivery sharing a dedupe key", async () => {
    const q = new InMemoryEventQueue([], () => NOW);

    await q.insert({
      eventName: "github.pr",
      source: "github",
      params: { repo: "a/b" },
      dedupeKey: "k1",
    });
    await q.insert({
      eventName: "github.pr",
      source: "github",
      params: { repo: "a/b" },
      dedupeKey: "k1",
    });
    expect(q.rows).toHaveLength(1);
    expect(q.rows[0].repo).toBe("a/b");
  });

  it("claims pending rows oldest-first and flips them to processing", async () => {
    const q = new InMemoryEventQueue([], () => NOW);

    await q.insert({ eventName: "e1", source: "cron" });
    await q.insert({ eventName: "e2", source: "cron" });
    const claimed = await q.claimBatch(1);

    expect(claimed.map((r) => r.event_name)).toEqual(["e1"]);
    expect(claimed[0]).toMatchObject({ status: "processing", attempts: 1 });
    expect((await q.claimBatch(10)).map((r) => r.event_name)).toEqual(["e2"]);
  });

  it("a claim excluding internal.ingest.spec_trace leaves those rows pending and claims the rest", async () => {
    const q = new InMemoryEventQueue([], () => NOW);

    await q.insert({
      eventName: "internal.ingest.spec_trace",
      source: "internal",
    });
    await q.insert({
      eventName: "github.pull_request.opened",
      source: "github",
    });
    const claimed = await q.claimBatch(10, ["internal.ingest.spec_trace"]);

    expect(claimed.map((r) => r.event_name)).toEqual([
      "github.pull_request.opened",
    ]);
    expect(q.rows[0]).toMatchObject({
      event_name: "internal.ingest.spec_trace",
      status: "pending",
      attempts: 0,
    });
    expect((await q.claimBatch(10)).map((r) => r.event_name)).toEqual([
      "internal.ingest.spec_trace",
    ]);
  });

  it("a failed row becomes claimable again only after its backoff elapses", async () => {
    let clock = NOW;
    const q = new InMemoryEventQueue([], () => clock);

    await q.insert({ eventName: "e1", source: "cron" });
    const [claimed] = await q.claimBatch(1);

    await q.markFailed(claimed.id, "boom", 60);
    expect(await q.claimBatch(10)).toEqual([]);
    clock = NOW + 61_000;
    expect((await q.claimBatch(10)).map((r) => r.event_name)).toEqual(["e1"]);
  });
});

describe("InMemoryEventQueue reaper", () => {
  it("reapStuck resets processing rows past the timeout to failed", async () => {
    const stuck: EventRow = {
      id: "1",
      event_name: "e",
      source: "cron",
      params: {},
      repo: null,
      dedupe_key: null,
      status: "processing",
      attempts: 1,
      error: null,
      captured_at: new Date(NOW - 1_000_000).toISOString(),
      claimed_at: new Date(NOW - 600_000).toISOString(),
      next_attempt_at: new Date(NOW - 1_000_000).toISOString(),
      handled_at: null,
    };
    const q = new InMemoryEventQueue([stuck], () => NOW);

    expect(await q.reapStuck(300)).toBe(1);
    expect(q.rows[0].status).toBe("failed");
  });

  it("pruneHandled drops terminal rows older than the window", async () => {
    const done: EventRow = {
      id: "1",
      event_name: "e",
      source: "cron",
      params: {},
      repo: null,
      dedupe_key: null,
      status: "done",
      attempts: 1,
      error: null,
      captured_at: new Date(NOW - 10 * 86_400_000).toISOString(),
      claimed_at: null,
      next_attempt_at: new Date(NOW - 10 * 86_400_000).toISOString(),
      handled_at: new Date(NOW - 8 * 86_400_000).toISOString(),
    };
    const q = new InMemoryEventQueue([done], () => NOW);

    expect(await q.pruneHandled(7)).toBe(1);
    expect(q.rows).toHaveLength(0);
  });
});
