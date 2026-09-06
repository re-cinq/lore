import { describe, it, expect } from "vitest";
import {
  chunkSchemaOrOrgShared,
  listChunkSchemas,
  resolveChunkSchemaForRepo,
} from "./chunk-schema.js";
import type { PgPool } from "../../memory-store.js";

function fakePool(...results: Array<{ rows: any[] }>): {
  pool: PgPool;
  calls: Array<{ text: string; params?: unknown[] }>;
} {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  const queue = [...results];
  const pool: PgPool = {
    async query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }> {
      calls.push({ text, params });

      return queue.length > 1 ? queue.shift()! : (queue[0] ?? { rows: [] });
    },
  };

  return { pool, calls };
}

describe("chunkSchemaOrOrgShared", () => {
  it("returns the candidate when it names a schema holding a chunks table", async () => {
    const { pool, calls } = fakePool({ rows: [{ table_schema: "platform" }] });

    expect(await chunkSchemaOrOrgShared(pool, "platform")).toBe("platform");
    expect(calls[0]?.text).toContain("table_name = 'chunks'");
    expect(calls[0]?.params).toEqual(["platform"]);
  });

  it("falls back to org_shared when the schema has no chunks table", async () => {
    const { pool } = fakePool({ rows: [] });

    expect(await chunkSchemaOrOrgShared(pool, "public")).toBe("org_shared");
  });

  it("falls back to org_shared for a null candidate without querying", async () => {
    const { pool, calls } = fakePool();

    expect(await chunkSchemaOrOrgShared(pool, null)).toBe("org_shared");
    expect(calls).toEqual([]);
  });

  it("falls back to org_shared for an injection-shaped candidate without querying", async () => {
    const { pool, calls } = fakePool();

    expect(await chunkSchemaOrOrgShared(pool, "a; DROP TABLE")).toBe(
      "org_shared",
    );
    expect(calls).toEqual([]);
  });

  it("short-circuits org_shared itself without an existence check", async () => {
    const { pool, calls } = fakePool();

    expect(await chunkSchemaOrOrgShared(pool, "org_shared")).toBe("org_shared");
    expect(calls).toEqual([]);
  });
});

describe("resolveChunkSchemaForRepo", () => {
  it("resolves the repo's team schema when it is provisioned", async () => {
    const { pool, calls } = fakePool(
      { rows: [{ team: "platform" }] },
      { rows: [{ table_schema: "platform" }] },
    );

    expect(await resolveChunkSchemaForRepo(pool, "octo/repo")).toBe("platform");
    expect(calls[0]?.text).toContain("SELECT team FROM lore.repos");
    expect(calls[0]?.params).toEqual(["octo/repo"]);
    expect(calls[1]?.text).toContain("table_name = 'chunks'");
  });

  it("falls back to org_shared when the repo has no team", async () => {
    const { pool, calls } = fakePool({ rows: [] });

    expect(await resolveChunkSchemaForRepo(pool, "octo/repo")).toBe(
      "org_shared",
    );
    expect(calls).toHaveLength(1);
  });

  it("falls back to org_shared when the team schema is not provisioned", async () => {
    const { pool } = fakePool({ rows: [{ team: "growth" }] }, { rows: [] });

    expect(await resolveChunkSchemaForRepo(pool, "octo/repo")).toBe(
      "org_shared",
    );
  });

  it("memoizes per pool so concurrent resolutions share one lookup", async () => {
    const { pool, calls } = fakePool(
      { rows: [{ team: "platform" }] },
      { rows: [{ table_schema: "platform" }] },
    );

    const [first, second] = await Promise.all([
      resolveChunkSchemaForRepo(pool, "octo/repo"),
      resolveChunkSchemaForRepo(pool, "octo/repo"),
    ]);

    expect([first, second]).toEqual(["platform", "platform"]);
    expect(calls).toHaveLength(2);
  });

  it("keeps pools isolated so a fresh pool re-resolves", async () => {
    const a = fakePool({ rows: [{ team: "platform" }] }, { rows: [] });
    const b = fakePool({ rows: [] });

    expect(await resolveChunkSchemaForRepo(a.pool, "octo/repo")).toBe(
      "org_shared",
    );
    expect(await resolveChunkSchemaForRepo(b.pool, "octo/repo")).toBe(
      "org_shared",
    );
    expect(b.calls).toHaveLength(1);
  });

  it("does not cache a failed lookup", async () => {
    let failFirst = true;
    const calls: string[] = [];
    const pool: PgPool = {
      async query<T>(text: string): Promise<{ rows: T[] }> {
        calls.push(text);

        if (failFirst) {
          failFirst = false;
          throw new Error("connection refused");
        }

        return { rows: [] as T[] };
      },
    };

    await expect(resolveChunkSchemaForRepo(pool, "octo/repo")).rejects.toThrow(
      new Error("connection refused"),
    );
    expect(await resolveChunkSchemaForRepo(pool, "octo/repo")).toBe(
      "org_shared",
    );
    expect(calls).toHaveLength(2);
  });
});

describe("listChunkSchemas", () => {
  it("lists provisioned chunk schemas and always includes org_shared", async () => {
    const { pool, calls } = fakePool({
      rows: [{ table_schema: "platform" }, { table_schema: "growth" }],
    });

    expect(await listChunkSchemas(pool)).toEqual([
      "platform",
      "growth",
      "org_shared",
    ]);
    expect(calls[0]?.text).toContain("table_name = 'chunks'");
  });

  it("drops regex-unsafe schema names and keeps a single org_shared", async () => {
    const { pool } = fakePool({
      rows: [{ table_schema: 'bad"; DROP' }, { table_schema: "org_shared" }],
    });

    expect(await listChunkSchemas(pool)).toEqual(["org_shared"]);
  });
});
