import { enforceTrue } from "../../lib/enforce.js";
// The EventDeliveriesPort contract, run against EVERY implementation.
//
// Same shape as the AssemblyRunsPort contract and for the same reason: the
// in-memory double is the behavioural spec, so it and the adapter must be held
// to ONE set of expectations rather than to a behaviour suite on one side and an
// SQL-text suite on the other. The Postgres half needs a migrated database and
// SKIPS loudly when there is none.

import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { InMemoryEventDeliveries } from "./event-deliveries-memory.js";
import { PgEventDeliveries } from "./event-deliveries-pg.js";
import type { EventDeliveriesPort } from "./event-deliveries-port.js";

const PG_CONFIG = {
  host: process.env.PGHOST ?? "localhost",
  port: Number(process.env.PGPORT ?? 5432),
  database: process.env.PGDATABASE ?? "lore",
  user: process.env.PGUSER ?? "lore",
  password: process.env.PGPASSWORD ?? "lore",
};

async function pgAvailable(): Promise<{ ok: boolean; why: string }> {
  let probe: Pool | undefined;

  try {
    probe = new Pool({ ...PG_CONFIG, connectionTimeoutMillis: 1000 });

    const { rows } = await probe.query<{ present: boolean }>(
      `SELECT to_regclass('pipeline.event_deliveries') IS NOT NULL AS present`,
    );

    return rows[0]?.present
      ? { ok: true, why: "" }
      : {
          ok: false,
          why: "pipeline.event_deliveries is absent — migrations not applied",
        };
  } catch (err) {
    return { ok: false, why: `unreachable: ${(err as Error).message}` };
  } finally {
    await probe?.end();
  }
}

const pg = await pgAvailable();
const pools: Pool[] = [];

afterAll(async () => {
  await Promise.all(pools.map((p) => p.end()));
});

describe("the Postgres implementation is actually exercised", () => {
  it("runs the Postgres contract, or explains why it is skipped", () => {
    enforceTrue(
      !(!pg.ok && process.env.LORE_REQUIRE_PG_CONTRACT === "1"),
      Error,
      `Postgres contract required but ${pg.why}`,
    );

    expect(pg.ok || pg.why.length > 0).toBe(true);
  });
});

function contract(name: string, make: () => EventDeliveriesPort): void {
  describe(`EventDeliveriesPort contract (${name})`, () => {
    const sub = () => `sub-${randomUUID().slice(0, 8)}`;
    const evt = () => `internal.test.${randomUUID().slice(0, 8)}`;

    it("delivers one event to every subscriber that asked for it", async () => {
      const port = make();
      const [a, b, eventName] = [sub(), sub(), evt()];

      await port.subscribe(a, [{ eventName }]);
      await port.subscribe(b, [{ eventName }]);
      await port.insert({ eventName, source: "internal" });

      expect(await port.claim(a, 10)).toHaveLength(1);
      expect(await port.claim(b, 10)).toHaveLength(1);
    });

    it("hands a subscriber only its own deliveries, never another's", async () => {
      const port = make();
      const [mine, other, eventName] = [sub(), sub(), evt()];

      await port.subscribe(mine, [{ eventName }]);
      await port.subscribe(other, [{ eventName }]);
      await port.insert({ eventName, source: "internal" });

      const claimed = await port.claim(mine, 10);

      expect(claimed.map((d) => d.subscriber)).toEqual([mine]);
    });

    it("carries the event's name and params onto the claimed delivery", async () => {
      const port = make();
      const [s, eventName] = [sub(), evt()];

      await port.subscribe(s, [{ eventName }]);
      await port.insert({
        eventName,
        source: "internal",
        params: { repo: "re-cinq/lore" },
      });

      expect(await port.claim(s, 10)).toMatchObject([
        { event_name: eventName, params: { repo: "re-cinq/lore" } },
      ]);
    });

    it("delivers nothing for an event nobody subscribed to", async () => {
      const port = make();
      const [s, eventName] = [sub(), evt()];

      await port.subscribe(s, [{ eventName: evt() }]);
      await port.insert({ eventName, source: "internal" });

      expect(await port.claim(s, 10)).toEqual([]);
    });

    it("hands out a delivery once, then not again while it is in flight", async () => {
      const port = make();
      const [s, eventName] = [sub(), evt()];

      await port.subscribe(s, [{ eventName }]);
      await port.insert({ eventName, source: "internal" });
      await port.claim(s, 10);

      expect(await port.claim(s, 10)).toEqual([]);
    });

    it("counts the attempt at claim, so a crash-looping handler still reaches its cap", async () => {
      const port = make();
      const [s, eventName] = [sub(), evt()];

      await port.subscribe(s, [{ eventName }]);
      await port.insert({ eventName, source: "internal" });

      expect((await port.claim(s, 10))[0].attempts).toBe(1);
    });

    it("never hands out an acked delivery again", async () => {
      const port = make();
      const [s, eventName] = [sub(), evt()];

      await port.subscribe(s, [{ eventName }]);
      await port.insert({ eventName, source: "internal" });

      const [d] = await port.claim(s, 10);

      await port.markDone(d.id);
      await port.reapStuck();

      expect(await port.claim(s, 10)).toEqual([]);
    });

    it("hands a failed delivery back once its backoff has passed", async () => {
      const port = make();
      const [s, eventName] = [sub(), evt()];

      await port.subscribe(s, [{ eventName }]);
      await port.insert({ eventName, source: "internal" });

      const [d] = await port.claim(s, 10);

      await port.markFailed(d.id, "boom", 0);

      expect(await port.claim(s, 10)).toHaveLength(1);
    });

    it("never hands out a dead-lettered delivery again", async () => {
      const port = make();
      const [s, eventName] = [sub(), evt()];

      await port.subscribe(s, [{ eventName }]);
      await port.insert({ eventName, source: "internal" });

      const [d] = await port.claim(s, 10);

      await port.markDead(d.id, "out of attempts");

      expect(await port.claim(s, 10)).toEqual([]);
    });

    it("re-subscribing an already-subscribed name leaves one subscription, not two", async () => {
      const port = make();
      const [s, eventName] = [sub(), evt()];

      await port.subscribe(s, [{ eventName }]);
      await port.subscribe(s, [{ eventName }]);
      await port.insert({ eventName, source: "internal" });

      expect(await port.claim(s, 10)).toHaveLength(1);
    });

    it("stamps the subscriber's declared timeout on the delivery, not the global default", async () => {
      const port = make();
      const [s, eventName] = [sub(), evt()];

      await port.subscribe(s, [{ eventName, visibilityTimeoutSeconds: 1800 }]);
      await port.insert({ eventName, source: "internal" });

      expect((await port.claim(s, 10))[0].visibility_timeout_seconds).toBe(
        1800,
      );
    });

    it("reaps a delivery past its own budget while one still inside its budget stays in flight", async () => {
      const port = make();
      const [s, fast, slow] = [sub(), evt(), evt()];

      await port.subscribe(s, [
        { eventName: fast, visibilityTimeoutSeconds: 0 },
        { eventName: slow, visibilityTimeoutSeconds: 600 },
      ]);
      await port.insert({ eventName: fast, source: "internal" });
      await port.insert({ eventName: slow, source: "internal" });
      await port.claim(s, 10);
      await port.reapStuck();

      expect((await port.claim(s, 10)).map((d) => d.event_name)).toEqual([
        fast,
      ]);
    });

    it("never collects an event a subscriber is still owed a delivery of", async () => {
      const port = make();
      const [s, eventName] = [sub(), evt()];

      await port.subscribe(s, [{ eventName }]);
      await port.insert({ eventName, source: "internal" });
      await port.pruneHandled(0);

      expect(await port.claim(s, 10)).toHaveLength(1);
    });

    it("holds back an excluded name so a busy serial family's rows stay pending", async () => {
      const port = make();
      const [s, busy, free] = [sub(), evt(), evt()];

      await port.subscribe(s, [{ eventName: busy }, { eventName: free }]);
      await port.insert({ eventName: busy, source: "internal" });
      await port.insert({ eventName: free, source: "internal" });

      expect(
        (await port.claim(s, 10, [busy])).map((d) => d.event_name),
      ).toEqual([free]);
      // Held back, not consumed: it is still there for the next drain.
      expect((await port.claim(s, 10)).map((d) => d.event_name)).toEqual([
        busy,
      ]);
    });

    it("reports an event no subscriber claimed, so the silent case is visible", async () => {
      const port = make();
      const eventName = evt();

      await port.insert({ eventName, source: "internal" });

      expect(await port.orphanedEvents(60)).toEqual(
        expect.arrayContaining([{ event_name: eventName, count: 1 }]),
      );
    });
  });
}

contract("in-memory", () => new InMemoryEventDeliveries());

if (pg.ok) {
  contract("postgres", () => {
    const pool = new Pool(PG_CONFIG);

    pools.push(pool);

    return new PgEventDeliveries(pool);
  });
}
