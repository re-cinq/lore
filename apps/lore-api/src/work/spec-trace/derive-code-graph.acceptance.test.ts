import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { ingestFiles } from "./ingest.js";
import { queryLiveGraph } from "@re-cinq/lore-shared";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "../../../../../");
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

  it("emits a depends-on edge from the consumer to the library (specs/lore-derived-code-graph/spec.md#1)", async () => {
    const edges = await queryLiveGraph(pool, { entity: "my-library" });
    const dependsOn = edges.find((e) => e.relation === "depends-on");
    expect(dependsOn).toBeDefined();
    expect(dependsOn?.entity).toBe("my-org/my-consumer");
    expect(dependsOn?.related_entity).toBe("my-library");
  });

  it("returns the importing file for a used symbol (specs/lore-derived-code-graph/spec.md#2)", async () => {
    const edges = await queryLiveGraph(pool, {
      entity: "usedExport",
      relationType: "uses",
    });
    expect(edges.some((e) => e.entity === "my-org/my-consumer/app.ts")).toBe(
      true,
    );
  });

  it("returns a none sentinel for an export with no importers (specs/lore-derived-code-graph/spec.md#2)", async () => {
    const edges = await queryLiveGraph(pool, {
      entity: "unusedExport",
      relationType: "uses",
    });
    expect(edges.length).toBeGreaterThan(0);
    expect(edges[0].relation).toBe("uses");
    expect(edges[0].entity).toBe("none");
  });

  it("lists each public export of the entry module in an exports edge set (specs/lore-derived-code-graph/spec.md#3)", async () => {
    const edges = await queryLiveGraph(pool, {
      entity: "my-library",
      relationType: "exports",
    });
    expect(edges.some((e) => e.related_entity === "BaseClass")).toBe(true);
  });

  it("per-repo import set contains used symbols and omits unused ones (specs/lore-derived-code-graph/spec.md#4)", async () => {
    const edges = await queryLiveGraph(pool, {
      repo: "my-org/my-consumer",
      relationType: "uses",
    });
    expect(edges.some((e) => e.related_entity === "usedExport")).toBe(true);
    expect(edges.some((e) => e.related_entity === "unusedExport")).toBe(false);
  });

  it("emits an extends edge from the subclass to its base type (specs/lore-derived-code-graph/spec.md#5)", async () => {
    const edges = await queryLiveGraph(pool, { entity: "SubClass" });
    const extendsEdge = edges.find((e) => e.relation === "extends");
    expect(extendsEdge).toBeDefined();
    expect(extendsEdge?.related_entity).toBe("BaseClass");
  });

  it("re-ingesting an unchanged repo produces an identical edge set (specs/lore-derived-code-graph/spec.md#6)", async () => {
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
