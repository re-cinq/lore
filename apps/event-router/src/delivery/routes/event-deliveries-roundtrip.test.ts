import { describe, it, expect, beforeEach } from "vitest";
import Hapi from "@hapi/hapi";
import { InMemoryEventDeliveries } from "@re-cinq/lore-shared/project/events/event-deliveries-memory.js";
import { HttpEventDeliveries } from "@re-cinq/lore-shared/project/events/event-deliveries-http.js";
import { eventDeliveryRoutes } from "./event-deliveries.js";
import { eventsRoute } from "./events.js";

const TOKEN = "tok-1";
const FLOOR = "floor";

let store: InMemoryEventDeliveries;
let clock: number;
let client: HttpEventDeliveries;

beforeEach(() => {
  clock = 1_000_000;
  store = new InMemoryEventDeliveries([], [], new Map(), () => clock);

  const server = Hapi.server({ port: 0 });

  server.route([
    eventsRoute({
      insert: (event) => store.insert(event),
      bearerToken: TOKEN,
    }),
    ...eventDeliveryRoutes({ deliveries: () => store, bearerToken: TOKEN }),
  ]);

  const injectAsFetch = (async (url: string, init: RequestInit) => {
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

  client = new HttpEventDeliveries("http://router.test", TOKEN, injectAsFetch);
});

describe("HttpEventDeliveries against the router's own routes", () => {
  it("registers a subscription and claims back the event it asked for", async () => {
    await client.subscribe(FLOOR, [{ eventName: "github.issues.labeled" }]);
    await client.insert({
      eventName: "github.issues.labeled",
      source: "github",
      params: { repo: "re-cinq/lore" },
    });

    expect(await client.claim(FLOOR, 10)).toMatchObject([
      { event_name: "github.issues.labeled", params: { repo: "re-cinq/lore" } },
    ]);
  });

  it("carries the declared timeout across the wire onto the delivery", async () => {
    await client.subscribe(FLOOR, [
      { eventName: "cron.backfill.tick", visibilityTimeoutSeconds: 1800 },
    ]);
    await client.insert({ eventName: "cron.backfill.tick", source: "cron" });

    expect((await client.claim(FLOOR, 10))[0].visibility_timeout_seconds).toBe(
      1800,
    );
  });

  it("acks a delivery so it is not handed out again", async () => {
    await client.subscribe(FLOOR, [{ eventName: "e" }]);
    await client.insert({ eventName: "e", source: "internal" });

    const [d] = await client.claim(FLOOR, 10);

    await client.markDone(d.id);
    clock += 10_000_000;
    await client.reapStuck();

    expect(await client.claim(FLOOR, 10)).toEqual([]);
  });

  it("fails a delivery back for another attempt after its backoff", async () => {
    await client.subscribe(FLOOR, [{ eventName: "e" }]);
    await client.insert({ eventName: "e", source: "internal" });

    const [d] = await client.claim(FLOOR, 10);

    await client.markFailed(d.id, "boom", 30);
    expect(await client.claim(FLOOR, 10)).toEqual([]);

    clock += 31_000;
    expect(await client.claim(FLOOR, 10)).toHaveLength(1);
  });

  it("dead-letters a delivery that has run out of attempts", async () => {
    await client.subscribe(FLOOR, [{ eventName: "e" }]);
    await client.insert({ eventName: "e", source: "internal" });

    const [d] = await client.claim(FLOOR, 10);

    await client.markDead(d.id, "out of attempts");

    expect(await client.claim(FLOOR, 10)).toEqual([]);
  });

  it("reaps a delivery its claimer never finished", async () => {
    await client.subscribe(FLOOR, [{ eventName: "e" }]);
    await client.insert({ eventName: "e", source: "internal" });
    await client.claim(FLOOR, 10);

    clock += 601_000;

    expect(await client.reapStuck()).toBe(1);
    expect(await client.claim(FLOOR, 10)).toHaveLength(1);
  });

  it("reports an event no subscriber received", async () => {
    await client.insert({ eventName: "nobody.wants.this", source: "internal" });

    expect(await client.orphanedEvents(60)).toEqual([
      { event_name: "nobody.wants.this", count: 1 },
    ]);
  });

  it("refuses every delivery route to a caller with no token", async () => {
    const anon = new HttpEventDeliveries(
      "http://router.test",
      undefined,
      (client as unknown as { fetchImpl: typeof fetch }).fetchImpl,
    );

    await expect(anon.claim(FLOOR, 10)).rejects.toThrow();
    await expect(anon.subscribe(FLOOR, [{ eventName: "e" }])).rejects.toThrow();
  });
});

describe("the claim's serial-family exclusion survives the wire", () => {
  it("holds back an excluded name, and leaves it claimable once it is not", async () => {
    await client.subscribe(FLOOR, [
      { eventName: "busy" },
      { eventName: "free" },
    ]);
    await client.insert({ eventName: "busy", source: "internal" });
    await client.insert({ eventName: "free", source: "internal" });

    const first = await client.claim(FLOOR, 10, ["busy"]);

    expect(first.map((d) => d.event_name)).toEqual(["free"]);

    const second = await client.claim(FLOOR, 10);

    expect(second.map((d) => d.event_name)).toEqual(["busy"]);
  });
});
