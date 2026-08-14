import { describe, it, expect } from "vitest";
import { buildChunkUnionQuery } from "./chunk-union.js";

const selectByType = (schema: string, paramOffset: number) => ({
  sql: `SELECT id FROM ${schema}.chunks WHERE content_type = $${paramOffset}`,
  params: ["task"],
});

describe("buildChunkUnionQuery", () => {
  it("returns null for zero schemas", () => {
    expect(buildChunkUnionQuery([], selectByType)).toBeNull();
  });

  it("joins branches with UNION ALL and offsets params per schema", () => {
    const result = buildChunkUnionQuery(
      ["platform", "org_shared"],
      selectByType,
    );

    expect(result).toEqual({
      sql:
        "SELECT id FROM platform.chunks WHERE content_type = $1" +
        " UNION ALL " +
        "SELECT id FROM org_shared.chunks WHERE content_type = $2",
      params: ["task", "task"],
    });
  });

  it("offsets branch params after baseParams", () => {
    const result = buildChunkUnionQuery(["platform"], selectByType, ["base"]);

    expect(result).toEqual({
      sql: "SELECT id FROM platform.chunks WHERE content_type = $2",
      params: ["base", "task"],
    });
  });

  it("wraps each branch and appends an outer clause when ordered", () => {
    const result = buildChunkUnionQuery(
      ["platform", "org_shared"],
      selectByType,
      [],
      { orderBy: "ingested_at DESC", limit: 50 },
    );

    expect(result).toEqual({
      sql:
        "(SELECT id FROM platform.chunks WHERE content_type = $1 ORDER BY ingested_at DESC LIMIT 50)" +
        " UNION ALL " +
        "(SELECT id FROM org_shared.chunks WHERE content_type = $2 ORDER BY ingested_at DESC LIMIT 50)" +
        " ORDER BY ingested_at DESC LIMIT 50",
      params: ["task", "task"],
    });
  });

  it("returns null for zero schemas when ordered", () => {
    const result = buildChunkUnionQuery([], selectByType, [], {
      orderBy: "score DESC",
      limit: 20,
    });

    expect(result).toBeNull();
  });

  it("throws on limit 0", () => {
    expect(() =>
      buildChunkUnionQuery(["platform"], selectByType, [], {
        orderBy: "score DESC",
        limit: 0,
      }),
    ).toThrow(new Error("chunk-union limit must be a positive integer: 0"));
  });

  it("throws on limit 1.5", () => {
    expect(() =>
      buildChunkUnionQuery(["platform"], selectByType, [], {
        orderBy: "score DESC",
        limit: 1.5,
      }),
    ).toThrow(new Error("chunk-union limit must be a positive integer: 1.5"));
  });

  it("throws on an orderBy term that is not column [ASC|DESC]", () => {
    expect(() =>
      buildChunkUnionQuery(["platform"], selectByType, [], {
        orderBy: "score; DROP TABLE chunks",
        limit: 20,
      }),
    ).toThrow(
      new Error(
        "chunk-union orderBy contains an unsafe term: score; DROP TABLE chunks",
      ),
    );
  });

  it("accepts comma-separated orderBy terms with directions", () => {
    const result = buildChunkUnionQuery(["platform"], selectByType, [], {
      orderBy: "ingested_at DESC, id DESC",
      limit: 50,
    });

    expect(result).toEqual({
      sql:
        "(SELECT id FROM platform.chunks WHERE content_type = $1 ORDER BY ingested_at DESC, id DESC LIMIT 50)" +
        " ORDER BY ingested_at DESC, id DESC LIMIT 50",
      params: ["task"],
    });
  });
});
