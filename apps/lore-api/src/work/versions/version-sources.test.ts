import { describe, it, expect, vi } from "vitest";
import type { FloorClient } from "@re-cinq/floor-client";
import type { Pool } from "pg";
import {
  latestMigrations,
  lineIdsOf,
  readOnFloor,
  readUiVersion,
} from "./version-sources.js";

describe("lineIdsOf", () => {
  it("reads merge from a shipped pipeline file's line id", () => {
    expect(
      lineIdsOf([{ name: "merge.yaml", text: "# c\nline:\n  id: merge\n" }]),
    ).toEqual(["merge"]);
  });
});

describe("readUiVersion", () => {
  it("reads the ui's build and packages from its public version route", async () => {
    const fetchFn = vi.fn(
      async (_url: string) =>
        new Response(
          JSON.stringify({ version: "abc1234", packages: { a: "1.0.0" } }),
        ),
    );

    expect({
      answer: await readUiVersion("http://ui:3000", fetchFn),
      url: fetchFn.mock.calls[0]?.[0],
    }).toEqual({
      answer: { build: "abc1234", packages: { a: "1.0.0" } },
      url: "http://ui:3000/api/version",
    });
  });

  it("answers no packages from a ui that predates them", async () => {
    const fetchFn = async () => new Response('{"version":"abc1234"}');

    expect(await readUiVersion("http://ui:3000", fetchFn)).toEqual({
      build: "abc1234",
      packages: {},
    });
  });

  it("refuses a ui answering 502", async () => {
    const fetchFn = async () => new Response("", { status: 502 });

    await expect(readUiVersion("http://ui:3000", fetchFn)).rejects.toThrow(
      new Error("lore-ui answered HTTP 502"),
    );
  });

  it("refuses when no ui url is configured", async () => {
    await expect(readUiVersion(undefined, fetch)).rejects.toThrow(
      new Error("no ui url configured"),
    );
  });
});

describe("latestMigrations", () => {
  it("answers the newest sql and floor migrations from schema_migrations", async () => {
    const query = vi.fn(async () => ({
      rows: [{ migration: "0129_a.sql", floor_migration: "floor/0009_b.ts" }],
    }));

    expect(await latestMigrations({ query } as unknown as Pool)).toEqual({
      migration: "0129_a.sql",
      floorMigration: "floor/0009_b.ts",
    });
  });
});

describe("latestMigrations' query", () => {
  it("counts only numbered sql files as the database migration, not floor or skills rows", async () => {
    const asked: string[] = [];
    const query = async (sql: string) => {
      asked.push(sql);

      return { rows: [{ migration: null, floor_migration: null }] };
    };

    await latestMigrations({ query } as unknown as Pool);

    expect(asked[0]).toContain("version ~ '^[0-9]{4}_.*[.]sql$'");
  });
});

describe("readOnFloor", () => {
  it("answers each shipped line's hash on the floor, null for one it lacks, and the agent count", async () => {
    const floor = {
      lines: {
        get: async (id: string) => (id === "merge" ? { hash: "h1" } : null),
      },
      agentDefinitions: { list: async () => [{}, {}, {}] },
    } as unknown as FloorClient;

    expect(await readOnFloor(floor, ["merge", "onboard"])).toEqual({
      pipelines: [
        { id: "merge", hash: "h1" },
        { id: "onboard", hash: null },
      ],
      agentDefinitions: 3,
    });
  });
});
