import { describe, it, expect, vi } from "vitest";
import type { Pool } from "pg";
import { pruneOrphanChunks } from "./prune-orphans.js";

type Call = { sql: string; params: unknown[] };

function scriptedPool(indexedPaths: string[], deletedRows: number) {
  const calls: Call[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });

    if (sql.includes("SELECT team FROM lore.repos")) {
      return { rows: [{ team: "platform" }] };
    }

    if (sql.includes("information_schema.tables")) {
      return { rows: [{ table_schema: "platform" }] };
    }

    if (sql.includes("SELECT DISTINCT file_path")) {
      return { rows: indexedPaths.map((file_path) => ({ file_path })) };
    }

    if (sql.startsWith("DELETE")) {
      return { rows: [], rowCount: deletedRows };
    }

    return { rows: [] };
  });

  return { pool: { query } as unknown as Pool, calls };
}

describe("pruneOrphanChunks", () => {
  it("deletes the 2 indexed paths absent from the tree in the repo's schema and reports 5 chunks gone", async () => {
    const { pool, calls } = scriptedPool(
      [
        "apps/floor/src/jobs/assembly-run/node-event-deps.ts",
        "apps/floor/src/work/assembly-run/node-event-deps.ts",
        "apps/lore-api/src/api/routes/features/features.test.ts",
      ],
      5,
    );

    const result = await pruneOrphanChunks(pool, "re-cinq/lore", [
      "apps/floor/src/work/assembly-run/node-event-deps.ts",
    ]);

    const del = calls.find((c) => c.sql.startsWith("DELETE"))!;

    expect({
      result,
      deleteParams: del.params,
      table: /platform\.chunks/.test(del.sql),
    }).toEqual({
      result: {
        schema: "platform",
        deleted_paths: [
          "apps/floor/src/jobs/assembly-run/node-event-deps.ts",
          "apps/lore-api/src/api/routes/features/features.test.ts",
        ],
        deleted_chunks: 5,
      },
      deleteParams: [
        "re-cinq/lore",
        [
          "apps/floor/src/jobs/assembly-run/node-event-deps.ts",
          "apps/lore-api/src/api/routes/features/features.test.ts",
        ],
      ],
      table: true,
    });
  });

  it("issues no DELETE when every indexed path is present and classifiable", async () => {
    const { pool, calls } = scriptedPool(["CLAUDE.md"], 0);

    const result = await pruneOrphanChunks(pool, "re-cinq/lore", ["CLAUDE.md"]);

    expect({
      result,
      deletes: calls.filter((c) => c.sql.startsWith("DELETE")).length,
    }).toEqual({
      result: { schema: "platform", deleted_paths: [], deleted_chunks: 0 },
      deletes: 0,
    });
  });
});
