import { describe, it, expect, beforeEach } from "vitest";
import Hapi from "@hapi/hapi";
import { InMemoryEventQueue } from "@re-cinq/lore-shared/project/events/event-queue-memory.js";
import { eventQueueRoutes } from "./event-queue.js";

const TOKEN = "tok-1";

let queue: InMemoryEventQueue;
let clock: number;

function server(): Hapi.Server {
  const s = Hapi.server({ port: 0 });

  s.route(eventQueueRoutes({ queue: () => queue, bearerToken: TOKEN }));

  return s;
}

const auth = { authorization: `Bearer ${TOKEN}` };

beforeEach(() => {
  queue = new InMemoryEventQueue([], () => clock);
  clock = 1_000_000;
});

describe("the drain loop's endpoints", () => {
  it("hands a claimed batch to the caller that asked for it", async () => {
    await queue.insert({ eventName: "cron.reindex.tick", source: "cron" });

    const res = await server().inject({
      method: "POST",
      url: "/api/events/claim",
      headers: auth,
      payload: JSON.stringify({ limit: 10 }),
    });

    expect(res.statusCode).toBe(200);
    expect(
      (res.result as { events: { event_name: string }[] }).events.map(
        (e) => e.event_name,
      ),
    ).toEqual(["cron.reindex.tick"]);
  });

  it("claims nothing twice, so two drainers cannot run the same event", async () => {
    await queue.insert({ eventName: "cron.reindex.tick", source: "cron" });

    const first = await server().inject({
      method: "POST",
      url: "/api/events/claim",
      headers: auth,
      payload: JSON.stringify({ limit: 10 }),
    });
    const second = await server().inject({
      method: "POST",
      url: "/api/events/claim",
      headers: auth,
      payload: JSON.stringify({ limit: 10 }),
    });

    expect((first.result as { events: unknown[] }).events).toHaveLength(1);
    expect((second.result as { events: unknown[] }).events).toEqual([]);
  });

  it("holds back an excluded event name so a busy serial family stays pending", async () => {
    await queue.insert({ eventName: "cron.reindex.tick", source: "cron" });

    const res = await server().inject({
      method: "POST",
      url: "/api/events/claim",
      headers: auth,
      payload: JSON.stringify({
        limit: 10,
        excludeEventNames: ["cron.reindex.tick"],
      }),
    });

    expect((res.result as { events: unknown[] }).events).toEqual([]);
  });

  it("marks a claimed event done", async () => {
    await queue.insert({ eventName: "cron.reindex.tick", source: "cron" });
    const [row] = await queue.claimBatch(1);

    const res = await server().inject({
      method: "POST",
      url: `/api/events/${row.id}/ack`,
      headers: auth,
    });

    expect(res.statusCode).toBe(204);
    expect(await queue.claimBatch(10)).toEqual([]);
  });

  it("fails a claimed event back for another attempt after its backoff", async () => {
    await queue.insert({ eventName: "cron.reindex.tick", source: "cron" });
    const [row] = await queue.claimBatch(1);

    const res = await server().inject({
      method: "POST",
      url: `/api/events/${row.id}/fail`,
      headers: auth,
      payload: JSON.stringify({ error: "boom", backoffSeconds: 0 }),
    });

    expect(res.statusCode).toBe(204);
    expect(await queue.claimBatch(10)).toHaveLength(1);
  });

  it("dead-letters an event that has run out of attempts", async () => {
    await queue.insert({ eventName: "cron.reindex.tick", source: "cron" });
    const [row] = await queue.claimBatch(1);

    const res = await server().inject({
      method: "POST",
      url: `/api/events/${row.id}/dead`,
      headers: auth,
      payload: JSON.stringify({ error: "unknown event name" }),
    });

    expect(res.statusCode).toBe(204);
    expect(await queue.claimBatch(10)).toEqual([]);
  });

  it("reaps rows a crashed claimer left in flight", async () => {
    await queue.insert({ eventName: "cron.reindex.tick", source: "cron" });
    await queue.claimBatch(1);
    clock += 60_000;

    const res = await server().inject({
      method: "POST",
      url: "/api/events/reap",
      headers: auth,
      payload: JSON.stringify({ timeoutSeconds: 0 }),
    });

    expect(res.statusCode).toBe(200);
    expect((res.result as { reaped: number }).reaped).toBe(1);
  });

  it("prunes handled rows to keep the claim index small", async () => {
    const res = await server().inject({
      method: "POST",
      url: "/api/events/prune",
      headers: auth,
      payload: JSON.stringify({ olderThanDays: 7 }),
    });

    expect(res.statusCode).toBe(200);
    expect((res.result as { pruned: number }).pruned).toBe(0);
  });

  it("refuses to hand out a batch to a caller with no token", async () => {
    const res = await server().inject({
      method: "POST",
      url: "/api/events/claim",
      payload: JSON.stringify({ limit: 10 }),
    });

    expect(res.statusCode).toBe(401);
  });

  it("refuses a claim whose body is not a claim", async () => {
    const res = await server().inject({
      method: "POST",
      url: "/api/events/claim",
      headers: auth,
      payload: JSON.stringify({ limit: "all of them" }),
    });

    expect(res.statusCode).toBe(400);
  });
});
