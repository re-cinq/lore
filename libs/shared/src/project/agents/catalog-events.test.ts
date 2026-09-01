import { describe, it, expect } from "vitest";
import { PgCatalogEvents } from "./catalog-events-pg.js";
import { InMemoryCatalogEvents } from "./catalog-events-memory.js";
import type { PgPool } from "../../memory-store.js";

/**
 * The catalog change log both ways: the InMemory double as the behavioral spec
 * (cursor filtering, batch cap, snapshot cursor pairing) and the Pg adapter's
 * SQL/binding through the house fake-pool stub.
 */

type Row = Record<string, unknown>;

function fakePool(
  respond: (text: string, params?: unknown[]) => Row[],
  capture: Array<{ text: string; params?: unknown[] }> = [],
): PgPool {
  return {
    query: async <T>(
      text: string,
      params?: unknown[],
    ): Promise<{ rows: T[] }> => {
      capture.push({ text, params });

      return { rows: respond(text, params) as T[] };
    },
  };
}

describe("InMemoryCatalogEvents", () => {
  it("listSince(2) returns only events with id greater than 2, in order", async () => {
    const log = new InMemoryCatalogEvents();

    log.append("implementation", null, "upsert");
    log.append("review", null, "upsert");
    log.append("implementation", "p-1", "upsert");
    log.append("implementation", "p-1", "delete");

    const events = await log.listSince("2", 10);

    expect(events).toEqual([
      { id: "3", name: "implementation", projectId: "p-1", op: "upsert" },
      { id: "4", name: "implementation", projectId: "p-1", op: "delete" },
    ]);
  });

  it("listSince caps the batch at the given limit", async () => {
    const log = new InMemoryCatalogEvents();

    log.append("a", null, "upsert");
    log.append("b", null, "upsert");
    log.append("c", null, "upsert");

    const events = await log.listSince("0", 2);

    expect(events.map((event) => event.name)).toEqual(["a", "b"]);
  });

  it("snapshot returns the current entries with the max event id as cursor", async () => {
    const log = new InMemoryCatalogEvents();

    log.setEntries([
      { name: "implementation", projectId: null },
      { name: "implementation", projectId: "p-1" },
    ]);
    log.append("implementation", null, "upsert");
    log.append("implementation", "p-1", "upsert");

    expect(await log.snapshot()).toEqual({
      entries: [
        { name: "implementation", projectId: null },
        { name: "implementation", projectId: "p-1" },
      ],
      cursor: "2",
    });
  });

  it("snapshot on an empty log carries cursor 0", async () => {
    const log = new InMemoryCatalogEvents();

    expect(await log.snapshot()).toEqual({ entries: [], cursor: "0" });
  });
});

describe("PgCatalogEvents", () => {
  it("listSince binds the cursor and limit and maps project_id to projectId", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];
    const repo = new PgCatalogEvents(
      fakePool(
        () => [{ id: "7", name: "review", project_id: null, op: "upsert" }],
        capture,
      ),
    );

    const events = await repo.listSince("5", 100);

    expect(events).toEqual([
      { id: "7", name: "review", projectId: null, op: "upsert" },
    ]);
    expect(capture[0]?.params).toEqual(["5", 100]);
    expect(capture[0]?.text).toContain("id > $1::bigint");
  });

  it("snapshot reads the max event id BEFORE the definitions so a concurrent append re-applies instead of skipping", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];
    const repo = new PgCatalogEvents(
      fakePool(
        (text) =>
          text.includes("MAX(id)")
            ? [{ max: "42" }]
            : [{ name: "implementation", project_id: "p-1" }],
        capture,
      ),
    );

    const snapshot = await repo.snapshot();

    expect(snapshot).toEqual({
      entries: [{ name: "implementation", projectId: "p-1" }],
      cursor: "42",
    });
    expect(capture[0]?.text).toContain("MAX(id)");
    expect(capture[1]?.text).toContain("lore.agent_definitions");
  });

  it("snapshot of an empty log falls back to cursor 0", async () => {
    const repo = new PgCatalogEvents(
      fakePool((text) => (text.includes("MAX(id)") ? [{ max: null }] : [])),
    );

    expect(await repo.snapshot()).toEqual({ entries: [], cursor: "0" });
  });
});
