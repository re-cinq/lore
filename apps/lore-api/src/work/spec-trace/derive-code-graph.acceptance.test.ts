import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ingestFiles } from "./ingest.js";
import { createTestPool } from "@re-cinq/lore-server-core/platform/test-db.js";
import { queryLiveGraph } from "@re-cinq/lore-shared";
import type { Pool } from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Root is at /workspace/target. This file is at /workspace/target/apps/lore-api/src/work/spec-trace/
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

  beforeEach(async () => {
    pool = await createTestPool();
  });

  afterEach(async () => {
    await pool.end();
  });

  it("derives and writes graph edges from code imports and package dependencies", async () => {
    const libFiles = [
      readFixture("library", "package.json"),
      readFixture("library", "index.ts"),
    ];

    await ingestFiles(pool, libFiles, {
      repo: "my-org/my-library",
      commit: "HEAD",
    });

    const consumerFiles = [
      readFixture("consumer", "package.json"),
      readFixture("consumer", "app.ts"),
    ];

    await ingestFiles(pool, consumerFiles, {
      repo: "my-org/my-consumer",
      commit: "HEAD",
    });

    // Statement 1. After one ingest, lore_query_graph({entity: "<library>"}) returns a depends-on edge from the consumer carrying the github: specifier and pinned: false
    const libEdges = await queryLiveGraph(pool, { entity: "my-library" });
    const dependsOn = libEdges.find((e) => e.relation === "depends-on");
    expect(dependsOn).toBeDefined();
    expect(dependsOn?.entity).toBe("my-org/my-consumer");
    expect(dependsOn?.related_entity).toBe("my-library");

    // Statement 2. lore_query_graph({entity: "<exported symbol>", relation_type: "uses"}) returns the importing files with their repos
    const usedEdges = await queryLiveGraph(pool, {
      entity: "usedExport",
      relationType: "uses",
    });
    expect(
      usedEdges.some((e) => e.entity === "my-org/my-consumer/app.ts"),
    ).toBe(true);

    // an export with no importers returns an explicit derived-and-empty result, distinguishable from not-derived
    const unusedEdges = await queryLiveGraph(pool, {
      entity: "unusedExport",
      relationType: "uses",
    });
    expect(unusedEdges.length).toBeGreaterThan(0);
    expect(unusedEdges[0].relation).toBe("uses");
    expect(unusedEdges[0].entity).toBe("none");

    // Statement 3. The exports edge set for the library lists each public export of its entry module with kind and source path
    const exportsEdges = await queryLiveGraph(pool, {
      entity: "my-library",
      relationType: "exports",
    });
    expect(exportsEdges.some((e) => e.related_entity === "BaseClass")).toBe(
      true,
    );

    // Statement 4. A per-repo import-set query returns exactly the symbols the consumer imports
    const consumerImports = await queryLiveGraph(pool, {
      repo: "my-org/my-consumer",
      relationType: "uses",
    });
    expect(consumerImports.some((e) => e.related_entity === "usedExport")).toBe(
      true,
    );
    expect(
      consumerImports.some((e) => e.related_entity === "unusedExport"),
    ).toBe(false);

    // Statement 5. lore_query_graph({entity: "<subclass>"}) returns an extends edge to its base type
    const subclassEdges = await queryLiveGraph(pool, { entity: "SubClass" });
    const extendsEdge = subclassEdges.find((e) => e.relation === "extends");
    expect(extendsEdge).toBeDefined();
    expect(extendsEdge?.related_entity).toBe("BaseClass");

    // Statement 6. Re-ingesting an unchanged repo produces an identical edge set: derivation is deterministic
    const beforeReingest = await queryLiveGraph(pool, {
      repo: "my-org/my-consumer",
    });
    await ingestFiles(pool, consumerFiles, {
      repo: "my-org/my-consumer",
      commit: "HEAD",
    });
    const afterReingest = await queryLiveGraph(pool, {
      repo: "my-org/my-consumer",
    });
    expect(afterReingest).toEqual(beforeReingest);
  });
});
