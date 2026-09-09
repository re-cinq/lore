import { describe, it, expect } from "vitest";
import { fakePgPool } from "../../../test-helpers/fake-pg-pool.js";
import { PgEventReporter } from "./event-reporter-pg.js";
import { InMemoryEventReporter } from "./event-reporter-memory.js";

const NOW = Date.UTC(2026, 5, 30, 12, 0, 0);

describe("PgEventReporter.insert", () => {
  it("writes through the shared insertEvent statement, collapsing on dedupe_key", async () => {
    const { pool, calls } = fakePgPool([{ rows: [] }]);

    await new PgEventReporter(pool).insert({
      eventName: "cron.lease_reaper.tick",
      source: "cron",
      dedupeKey: "cron:lease_reaper:2026-06-30T12:00Z",
    });

    expect(calls[0].text).toContain("INSERT INTO pipeline.events");
    expect(calls[0].text).toContain("ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING");
  });
});

describe("InMemoryEventReporter.insert", () => {
  it("collapses a redelivery sharing a dedupe key", async () => {
    const reporter = new InMemoryEventReporter([], () => NOW);

    await reporter.insert({
      eventName: "github.pr",
      source: "github",
      params: { repo: "a/b" },
      dedupeKey: "k1",
    });
    await reporter.insert({
      eventName: "github.pr",
      source: "github",
      params: { repo: "a/b" },
      dedupeKey: "k1",
    });

    expect(reporter.rows).toEqual([
      {
        id: "1",
        event_name: "github.pr",
        source: "github",
        params: { repo: "a/b" },
        repo: "a/b",
        dedupe_key: "k1",
        captured_at: "2026-06-30T12:00:00.000Z",
      },
    ]);
  });

  it("keeps two events with no dedupe key, in arrival order", async () => {
    const reporter = new InMemoryEventReporter([], () => NOW);

    await reporter.insert({ eventName: "e1", source: "cron" });
    await reporter.insert({ eventName: "e2", source: "cron" });

    expect(reporter.rows.map((r) => r.event_name)).toEqual(["e1", "e2"]);
  });
});
