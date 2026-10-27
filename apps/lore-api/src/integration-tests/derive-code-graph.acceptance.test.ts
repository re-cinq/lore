import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { ingestFiles } from "../work/spec-trace/ingest.js";
import { queryLiveGraph } from "@re-cinq/lore-shared";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "../../../../");
const fixturesDir = join(
  repoRoot,
  "specs/lore-derived-code-graph/__tests__/fixtures",
);

function readFixture(repo: string, filePath: string) {
  const content = readFileSync(join(fixturesDir, repo, filePath), "utf-8");

  return { path: filePath, content };
}

describe("Lore Derived Code Graph", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({
      host: process.env.LORE_DB_HOST || "localhost",
      port: parseInt(process.env.LORE_DB_PORT || "5432"),
      database: process.env.LORE_DB_NAME || "lore_test",
      user: process.env.LORE_DB_USER || "lore",
      password: process.env.LORE_DB_PASSWORD || "lore",
    });
    await ingestFiles(
      pool,
      [
        readFixture("library", "package.json"),
        readFixture("library", "index.ts"),
      ],
      { repo: "my-org/my-library", commit: "HEAD" },
    );
    await ingestFiles(
      pool,
      [
        readFixture("consumer", "package.json"),
        readFixture("consumer", "app.ts"),
      ],
      { repo: "my-org/my-consumer", commit: "HEAD" },
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it("emits a depends-on edge from the consumer to the library", async () => {
    const edges = await queryLiveGraph(pool, { entity: "my-library" });
    const dependsOn = edges.find((e) => e.relation === "depends-on");

    expect(dependsOn).toMatchObject({
      entity: "my-org/my-consumer",
      related_entity: "my-library",
      properties: { specifier: "github:my-org/my-library", pinned: false },
    });
  });

  it("returns the importing file for a used symbol", async () => {
    const edges = await queryLiveGraph(pool, {
      entity: "usedExport",
      relationType: "uses",
    });

    expect(edges.map((e) => e.entity)).toEqual(["my-org/my-consumer/app.ts"]);
  });

  it("returns a none sentinel for an export with no importers", async () => {
    const edges = await queryLiveGraph(pool, {
      entity: "unusedExport",
      relationType: "uses",
    });

    expect(edges.length).toBeGreaterThan(0);
    expect(edges[0].relation).toBe("uses");
    expect(edges[0].entity).toBe("none");
  });

  it("lists each public export of the entry module in an exports edge set", async () => {
    const edges = await queryLiveGraph(pool, {
      entity: "my-library",
      relationType: "exports",
    });

    expect(
      edges.map((e) => ({ symbol: e.related_entity, ...e.properties })),
    ).toEqual(
      expect.arrayContaining([
        { symbol: "BaseClass", kind: "class", path: "index.ts" },
        { symbol: "usedExport", kind: "const", path: "index.ts" },
        { symbol: "unusedExport", kind: "const", path: "index.ts" },
      ]),
    );
  });

  it("lists no exports from a module that is not the entry module", async () => {
    const edges = await queryLiveGraph(pool, {
      entity: "my-consumer",
      relationType: "exports",
    });

    expect(edges).toEqual([]);
  });

  it("per-repo import set contains used symbols and omits unused ones", async () => {
    const edges = await queryLiveGraph(pool, {
      repo: "my-org/my-consumer",
      relationType: "uses",
    });

    expect(edges.some((e) => e.related_entity === "usedExport")).toBe(true);
    expect(edges.some((e) => e.related_entity === "unusedExport")).toBe(false);
  });

  it("emits an extends edge from the subclass to its base type", async () => {
    const edges = await queryLiveGraph(pool, { entity: "SubClass" });
    const extendsEdge = edges.find((e) => e.relation === "extends");

    expect(extendsEdge).toMatchObject({
      related_entity: "BaseClass",
      properties: { added_members: ["addedMethod"], path: "app.ts" },
    });
  });

  it("re-ingesting an unchanged repo produces an identical edge set", async () => {
    const before = await queryLiveGraph(pool, {
      repo: "my-org/my-consumer",
    });

    await ingestFiles(
      pool,
      [
        readFixture("consumer", "package.json"),
        readFixture("consumer", "app.ts"),
      ],
      { repo: "my-org/my-consumer", commit: "HEAD" },
    );
    const after = await queryLiveGraph(pool, {
      repo: "my-org/my-consumer",
    });

    expect(after).toEqual(before);
  });
});
