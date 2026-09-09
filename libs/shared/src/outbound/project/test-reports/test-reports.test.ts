import { describe, it, expect } from "vitest";
import { InMemoryTestReports } from "./test-reports-memory.js";
import { PgTestReports } from "./test-reports-pg.js";
import type { NewTestReport } from "./test-reports-port.js";
import type { PgPool } from "../../memory-store.js";

function report(overrides: Partial<NewTestReport> = {}): NewTestReport {
  return {
    repo: "o/r",
    commit: "abc123",
    branch: "lore/ticket-7",
    tests: [{ id: "a.test.ts::adds", name: "adds", file: "a.test.ts" }],
    outcomes: { "a.test.ts::adds": true },
    ...overrides,
  };
}

function ticking(): () => Date {
  let tick = 0;

  return () => new Date(1_700_000_000_000 + tick++ * 1000);
}

describe("InMemoryTestReports upsertLatest", () => {
  it("replaces the row for the same repo and commit instead of adding a second one", async () => {
    const store = new InMemoryTestReports({ now: ticking() });

    await store.upsertLatest(
      report({ outcomes: { "a.test.ts::adds": false } }),
    );
    const replaced = await store.upsertLatest(report());

    expect(store.rows).toEqual([replaced]);
    expect(replaced.outcomes).toEqual({ "a.test.ts::adds": true });
  });

  it("keeps rows for different commits apart", async () => {
    const store = new InMemoryTestReports({ now: ticking() });

    await store.upsertLatest(report({ commit: "one" }));
    await store.upsertLatest(report({ commit: "two" }));

    expect(store.rows.map((row) => row.commit)).toEqual(["one", "two"]);
  });
});

describe("InMemoryTestReports latestForBranch", () => {
  it("picks the most recently received report on the branch", async () => {
    const store = new InMemoryTestReports({ now: ticking() });

    await store.upsertLatest(report({ commit: "older" }));
    await store.upsertLatest(report({ commit: "newer" }));
    await store.upsertLatest(report({ commit: "elsewhere", branch: "main" }));

    expect(await store.latestForBranch("o/r", "lore/ticket-7")).toMatchObject({
      commit: "newer",
    });
  });

  it("returns null when CI posted nothing for the branch", async () => {
    const store = new InMemoryTestReports();

    expect(await store.latestForBranch("o/r", "lore/ticket-7")).toBeNull();
  });
});

describe("InMemoryTestReports forCommit", () => {
  it("returns the exact commit's report and null for an unknown one", async () => {
    const store = new InMemoryTestReports();

    await store.upsertLatest(report({ commit: "abc123" }));

    expect(await store.forCommit("o/r", "abc123")).toMatchObject({
      commit: "abc123",
    });
    expect(await store.forCommit("o/r", "zzz")).toBeNull();
  });
});

describe("PgTestReports", () => {
  it("upserts on the (repo, commit) key and returns the stored row with a string id", async () => {
    const calls: Array<{ text: string; params?: unknown[] }> = [];
    const pool: PgPool = {
      async query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }> {
        calls.push({ text, params });

        return {
          rows: [
            {
              id: 7,
              repo: "o/r",
              commit: "abc123",
              branch: "lore/ticket-7",
              tests: [],
              outcomes: {},
              received_at: new Date(0),
            },
          ] as T[],
        };
      },
    };

    const row = await new PgTestReports(pool).upsertLatest(report());

    expect(calls[0].text).toContain("ON CONFLICT (repo, commit) DO UPDATE");
    expect(calls[0].params?.slice(0, 3)).toEqual([
      "o/r",
      "abc123",
      "lore/ticket-7",
    ]);
    expect(row).toEqual({
      id: "7",
      repo: "o/r",
      commit: "abc123",
      branch: "lore/ticket-7",
      tests: [],
      outcomes: {},
      receivedAt: new Date(0),
    });
  });
});
