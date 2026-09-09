import { describe, it, expect, vi } from "vitest";
import type { Pool } from "pg";
import { backfillEmbeddings } from "./backfill.js";

type Call = { sql: string; params: unknown[] };

const chunk = (id: string, text: string) => ({ id, text });

function scriptedPool(
  rowsByTable: Record<string, Array<{ id: string; text: string }>>,
  remaining: number,
) {
  const calls: Call[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });

    if (/COUNT\(\*\)/.test(sql)) {
      return {
        rows: [
          { count: sql.includes("platform.chunks") ? String(remaining) : "0" },
        ],
      };
    }
    const table = Object.keys(rowsByTable).find((t) => sql.includes(t));

    return { rows: table && /^SELECT/.test(sql) ? rowsByTable[table] : [] };
  });

  return { pool: { query } as unknown as Pool, calls };
}

const updates = (calls: Call[]) =>
  calls.filter((c) => c.sql.startsWith("UPDATE"));

describe("backfillEmbeddings", () => {
  it("embeds the 3 NULL-embedding chunk rows and reports remaining 0", async () => {
    const { pool, calls } = scriptedPool(
      {
        "platform.chunks": [
          chunk("c1", "one"),
          chunk("c2", "two"),
          chunk("c3", "three"),
        ],
      },
      0,
    );
    const embed = vi.fn(async () => [0.1, 0.2]);

    const result = await backfillEmbeddings(pool, embed, {
      schema: "platform",
      limit: 100,
      where: "missing",
    });

    expect({ result, updated: updates(calls).map((c) => c.params[1]) }).toEqual(
      {
        result: { embedded: 3, failed: 0, remaining: 0, stopped: false },
        updated: ["c1", "c2", "c3"],
      },
    );
  });

  it("stops after the first null embedding and reports the 2 untouched rows as remaining", async () => {
    const { pool, calls } = scriptedPool(
      {
        "platform.chunks": [
          chunk("c1", "one"),
          chunk("c2", "two"),
          chunk("c3", "three"),
        ],
      },
      2,
    );
    const embed = vi.fn(async (text: string) =>
      text === "two" ? null : [0.5],
    );

    const result = await backfillEmbeddings(pool, embed, {
      schema: "platform",
      limit: 100,
      where: "missing",
    });

    expect({ result, updated: updates(calls).map((c) => c.params[1]) }).toEqual(
      {
        result: { embedded: 1, failed: 1, remaining: 2, stopped: true },
        updated: ["c1"],
      },
    );
  });

  it("embeds the stripped text of a link-carrying chunk and marks it, selecting only unmarked link carriers when where is stale_links", async () => {
    const { pool, calls } = scriptedPool(
      {
        "platform.chunks": [
          chunk(
            "c1",
            "- FR1 Ends with a commit. ([validated by `a.test.ts:6`](libs/a.test.ts#L6))",
          ),
        ],
      },
      0,
    );
    const embed = vi.fn(async (_text: string) => [0.9]);

    await backfillEmbeddings(pool, embed, {
      schema: "platform",
      limit: 10,
      where: "stale_links",
    });

    const select = calls.find((c) => /^SELECT id/.test(c.sql))!;
    const update = updates(calls)[0];

    expect({
      embeddedText: embed.mock.calls[0][0],
      selectsLinkCarriers: select.sql.includes(
        "content ~ '\\(\\[validated by'",
      ),
      selectsUnmarked: select.sql.includes("embedded_stripped"),
      marks: update.sql.includes("embedded_stripped"),
    }).toEqual({
      embeddedText: "- FR1 Ends with a commit.",
      selectsLinkCarriers: true,
      selectsUnmarked: true,
      marks: true,
    });
  });

  it("walks memories and facts after the chunk schema when where is missing, spending the limit across them", async () => {
    const { pool, calls } = scriptedPool(
      {
        "platform.chunks": [chunk("c1", "one")],
        "memory.memories": [chunk("m1", "a memory")],
        "memory.facts": [chunk("f1", "a fact")],
      },
      0,
    );

    const result = await backfillEmbeddings(pool, async () => [1], {
      schema: "platform",
      limit: 2,
      where: "missing",
    });

    expect({ result, updated: updates(calls).map((c) => c.params[1]) }).toEqual(
      {
        result: { embedded: 2, failed: 0, remaining: 0, stopped: false },
        updated: ["c1", "m1"],
      },
    );
  });
});
