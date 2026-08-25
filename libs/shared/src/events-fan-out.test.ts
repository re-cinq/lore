import { describe, it, expect } from "vitest";
import { fakePgPool } from "./test-helpers/fake-pg-pool.js";
import { insertEvent } from "./events.js";

describe("insertEvent fan-out", () => {
  it("creates the event and its deliveries in one statement", async () => {
    const { pool, calls } = fakePgPool([{ rows: [] }]);

    await insertEvent(pool, {
      eventName: "github.issues.labeled",
      source: "github",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain("WITH ev AS (");
    expect(calls[0].text).toContain("INSERT INTO pipeline.events");
    expect(calls[0].text).toContain("INSERT INTO pipeline.event_deliveries");
  });

  it("returns the inserted event to the fan-out so a deduplicated insert delivers nothing", async () => {
    const { pool, calls } = fakePgPool([{ rows: [] }]);

    await insertEvent(pool, {
      eventName: "github.issues.labeled",
      source: "github",
      dedupeKey: "github:delivery-1",
    });

    expect(calls[0].text).toContain("RETURNING id, event_name");
    expect(calls[0].text).toContain(
      "ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING",
    );
  });

  it("passes the event columns unchanged, repo denormalized from params", async () => {
    const { pool, calls } = fakePgPool([{ rows: [] }]);

    await insertEvent(pool, {
      eventName: "github.issues.labeled",
      source: "github",
      params: { repo: "re-cinq/lore" },
      dedupeKey: "d1",
    });

    expect(calls[0].params).toEqual([
      "github.issues.labeled",
      "github",
      JSON.stringify({ repo: "re-cinq/lore" }),
      "re-cinq/lore",
      "d1",
    ]);
  });
});
