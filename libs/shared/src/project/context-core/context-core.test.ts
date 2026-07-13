import { describe, it, expect } from "vitest";
import { PgContextCore } from "./context-core-pg.js";
import { InMemoryContextCore } from "./context-core-memory.js";
import type { PgPool } from "../../memory-store.js";

function fakePool(rows: unknown[] = []): {
  pool: PgPool;
  calls: Array<{ text: string; params?: unknown[] }>;
} {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  const pool: PgPool = {
    async query(text: string, params?: unknown[]) {
      calls.push({ text, params });

      return { rows };
    },
  };

  return { pool, calls };
}

describe("PgContextCore adapter", () => {
  it("reads the latest production eval_score for a namespace", async () => {
    const { pool, calls } = fakePool([{ eval_score: 0.82 }]);

    const score = await new PgContextCore(pool).latest("platform");

    expect(score).toEqual(0.82);
    expect(calls[0]?.text).toContain("FROM pipeline.context_core_history");
    expect(calls[0]?.text).toContain("status = 'production'");
    expect(calls[0]?.params).toEqual(["platform"]);
  });

  it("returns null when a namespace has no production history yet", async () => {
    const { pool } = fakePool([]);

    expect(await new PgContextCore(pool).latest("platform")).toEqual(null);
  });

  it("inserts a history row with the run version, namespace, score, and status", async () => {
    const { pool, calls } = fakePool();

    await new PgContextCore(pool).insert({
      version: "v2026-06-30-platform",
      namespace: "platform",
      evalScore: 0.91,
      status: "production",
    });

    expect(calls[0]?.text).toContain(
      "INSERT INTO pipeline.context_core_history",
    );
    expect(calls[0]?.params).toEqual([
      "v2026-06-30-platform",
      "platform",
      0.91,
      "production",
    ]);
  });
});

describe("InMemoryContextCore double", () => {
  it("resolves latest from the most-recent production insert", async () => {
    const store = new InMemoryContextCore();

    await store.insert({
      version: "v1",
      namespace: "platform",
      evalScore: 0.7,
      status: "production",
    });
    await store.insert({
      version: "v2",
      namespace: "platform",
      evalScore: 0.6,
      status: "no-change",
    });
    await store.insert({
      version: "v3",
      namespace: "platform",
      evalScore: 0.85,
      status: "production",
    });

    expect(await store.latest("platform")).toEqual(0.85);
  });

  it("ignores other namespaces and non-production rows when resolving latest", async () => {
    const store = new InMemoryContextCore();

    await store.insert({
      version: "v1",
      namespace: "other",
      evalScore: 0.99,
      status: "production",
    });
    await store.insert({
      version: "v2",
      namespace: "platform",
      evalScore: 0.4,
      status: "rejected-regression",
    });

    expect(await store.latest("platform")).toEqual(null);
  });

  it("keeps every inserted record for assertion", async () => {
    const store = new InMemoryContextCore();

    await store.insert({
      version: "v1",
      namespace: "platform",
      evalScore: 0.5,
      status: "no-change",
    });

    expect(store.records).toEqual([
      {
        version: "v1",
        namespace: "platform",
        evalScore: 0.5,
        status: "no-change",
      },
    ]);
  });
});
