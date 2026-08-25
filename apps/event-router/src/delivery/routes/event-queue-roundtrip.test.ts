// The client and the routes are two halves of one contract, written apart. This
// drives the REAL `HttpEventQueue` against the REAL routes over hapi's inject,
// so a path, a field name or a status code that disagrees fails here rather
// than in a cluster.

import { describe, it, expect, beforeEach } from "vitest";
import Hapi from "@hapi/hapi";
import { InMemoryEventQueue } from "@re-cinq/lore-shared/project/events/event-queue-memory.js";
import { HttpEventQueue } from "@re-cinq/lore-shared/project/events/event-queue-http.js";
import { eventQueueRoutes } from "./event-queue.js";
import { eventsRoute } from "./events.js";

const TOKEN = "tok-1";

let queue: InMemoryEventQueue;
let clock: number;
let client: HttpEventQueue;
let injectAsFetch: typeof fetch;

beforeEach(() => {
  // A clock the test drives. `reapStuck(0)` compares `claimed_at < now()`
  // strictly, so a claim and a reap landing in the same millisecond reap
  // nothing — real time made this assertion a coin flip roughly one run in six.
  queue = new InMemoryEventQueue([], () => clock);
  clock = 1_000_000;

  const server = Hapi.server({ port: 0 });

  server.route([
    eventsRoute({
      insert: (event) => queue.insert(event),
      bearerToken: TOKEN,
    }),
    ...eventQueueRoutes({ queue: () => queue, bearerToken: TOKEN }),
  ]);

  // `fetch` over inject: no socket, but every layer above it is the real one.
  injectAsFetch = (async (url: string, init: RequestInit) => {
    const res = await server.inject({
      method: (init.method ?? "GET") as "POST",
      url: new URL(url).pathname,
      headers: init.headers as Record<string, string>,
      ...(init.body ? { payload: String(init.body) } : {}),
    });

    return new Response(res.statusCode === 204 ? null : res.payload, {
      status: res.statusCode,
    });
  }) as unknown as typeof fetch;

  client = new HttpEventQueue("http://router.test", TOKEN, injectAsFetch);
});

describe("HttpEventQueue against the router's own routes", () => {
  it("reports an event and claims it back", async () => {
    await client.insert({ eventName: "cron.reindex.tick", source: "cron" });

    const claimed = await client.claimBatch(10);

    expect(claimed.map((e) => e.event_name)).toEqual(["cron.reindex.tick"]);
  });

  it("acks a claimed event so it is not handed out again", async () => {
    await client.insert({ eventName: "cron.reindex.tick", source: "cron" });
    const [row] = await client.claimBatch(10);

    await client.markDone(row.id);

    expect(await client.claimBatch(10)).toEqual([]);
  });

  it("fails an event back for another attempt", async () => {
    await client.insert({ eventName: "cron.reindex.tick", source: "cron" });
    const [row] = await client.claimBatch(10);

    await client.markFailed(row.id, "boom", 0);

    expect(await client.claimBatch(10)).toHaveLength(1);
  });

  it("dead-letters an event for good", async () => {
    await client.insert({ eventName: "cron.reindex.tick", source: "cron" });
    const [row] = await client.claimBatch(10);

    await client.markDead(row.id, "unknown event name");

    expect(await client.claimBatch(10)).toEqual([]);
  });

  it("reaps and prunes, returning the counts the reaper logs", async () => {
    await client.insert({ eventName: "cron.reindex.tick", source: "cron" });
    await client.claimBatch(10);
    clock += 60_000;

    expect(await client.reapStuck(0)).toBe(1);
    expect(await client.pruneHandled(7)).toBe(0);
  });

  it("surfaces a refusal rather than reporting work that never landed", async () => {
    // Same transport, same routes — only the credential differs.
    const wrongToken = new HttpEventQueue(
      "http://router.test",
      "not-the-token",
      injectAsFetch,
    );

    await expect(wrongToken.claimBatch(10)).rejects.toThrow(
      /\/api\/events\/claim failed: 401/,
    );
  });
});
