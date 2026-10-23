import { describe, it, expect } from "vitest";
import type { PgPool } from "../../memory-store.js";
import { InMemoryChangelogWeeks } from "./changelog-weeks-memory.js";
import { PgChangelogWeeks } from "./changelog-weeks-pg.js";

const week = (weekKey: string, intro = "") => ({
  repo: "re-cinq/lore",
  weekKey,
  intro,
  changes: [],
});

describe("InMemoryChangelogWeeks", () => {
  it("keeps one row per repo and week, the last write winning", async () => {
    const weeks = new InMemoryChangelogWeeks();

    await weeks.upsert(week("2026-W42", "first"));
    await weeks.upsert(week("2026-W42", "second"));

    expect(weeks.rows.map((row) => row.intro)).toEqual(["second"]);
  });

  it("answers 2026-W42 as the one written of W42 and W43", async () => {
    const weeks = new InMemoryChangelogWeeks();

    await weeks.upsert(week("2026-W42"));

    expect(
      await weeks.writtenWeeks("re-cinq/lore", ["2026-W43", "2026-W42"]),
    ).toEqual(["2026-W42"]);
  });

  it("pages newest first, before 2026-W43 giving W42 then W41", async () => {
    const weeks = new InMemoryChangelogWeeks();

    for (const key of ["2026-W41", "2026-W43", "2026-W42", "2026-W40"]) {
      await weeks.upsert(week(key));
    }

    expect(
      (await weeks.page("re-cinq/lore", { before: "2026-W43", limit: 2 })).map(
        (row) => row.weekKey,
      ),
    ).toEqual(["2026-W42", "2026-W41"]);
  });
});

function fakePool(rowsByCall: unknown[][] = []) {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  const pool: PgPool = {
    async query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }> {
      calls.push({ text, params });

      return { rows: (rowsByCall[calls.length - 1] ?? []) as T[] };
    },
  };

  return { pool, calls };
}

describe("PgChangelogWeeks", () => {
  it("upserts on repo and week with the changes as jsonb", async () => {
    const { pool, calls } = fakePool();

    await new PgChangelogWeeks(pool).upsert(week("2026-W42", "Intro"));

    expect({ sql: calls[0]?.text, params: calls[0]?.params }).toEqual({
      sql: expect.stringContaining("ON CONFLICT (repo, week_key) DO UPDATE"),
      params: ["re-cinq/lore", "2026-W42", "Intro", "[]"],
    });
  });

  it("maps a page row's columns onto the model", async () => {
    const writtenAt = new Date("2026-10-26T06:00:00Z");
    const { pool, calls } = fakePool([
      [
        {
          repo: "re-cinq/lore",
          week_key: "2026-W43",
          intro: "Intro",
          changes: [],
          written_at: writtenAt,
        },
      ],
    ]);

    const rows = await new PgChangelogWeeks(pool).page("re-cinq/lore", {
      limit: 8,
    });

    expect({ rows, params: calls[0]?.params }).toEqual({
      rows: [{ ...week("2026-W43", "Intro"), writtenAt }],
      params: ["re-cinq/lore", null, 8],
    });
  });
});
