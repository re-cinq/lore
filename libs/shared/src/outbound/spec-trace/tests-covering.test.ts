import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import * as dgraph from "dgraph-js-http";
import { findRepoRoot } from "../../lib/repo-root.js";
import { dgraphReachable } from "../../lib/dgraph-test-gate.js";
import { upsertByXid, replaceEdgeWithFacets } from "./dgraph-upsert.js";
import { preferOverlay, testsCoveringInScope } from "./tests-covering.js";
import {
  mainScope,
  overlayScope,
  scopedXid,
  type TraceScope,
} from "../../domain/spec-trace/trace-scope.js";

const DGRAPH_HTTP = process.env.DGRAPH_HTTP ?? "http://localhost:8081";
const APPLIER = join(
  findRepoRoot(),
  "scripts",
  "infra",
  "setup-spec-trace-schema.sh",
);

const reachable = await dgraphReachable();

describe("preferOverlay", () => {
  const fromMain = { testFile: "a.test.ts", origin: "main" as const };
  const fromOverlay = { testFile: "b.test.ts", origin: "overlay" as const };

  it("replaces main's answer for the file when the overlay covers it", () => {
    expect(preferOverlay([fromMain], [fromOverlay])).toEqual([fromOverlay]);
  });

  it("falls through to main for a file the branch never touched", () => {
    expect(preferOverlay([fromMain], [])).toEqual([fromMain]);
  });

  it("returns nothing when neither scope covers the file", () => {
    expect(preferOverlay([], [])).toEqual([]);
  });
});

describe.skipIf(!reachable)("testsCoveringInScope (live Dgraph)", () => {
  const client = new dgraph.DgraphClient(
    new dgraph.DgraphClientStub(DGRAPH_HTTP),
  );

  beforeAll(() => {
    execFileSync("bash", [APPLIER], {
      env: { ...process.env, DGRAPH_HTTP },
      stdio: "pipe",
    });
  });

  async function seedCoverage(
    scope: TraceScope,
    covered: { file: string; ranges: string },
  ): Promise<void> {
    const testFile = "src/widget.test.ts";
    const fileUid = await upsertByXid(
      client,
      "File",
      scopedXid(scope, covered.file),
      { "File.repo": scope.key, "File.path": covered.file },
    );
    const coverageUid = await upsertByXid(
      client,
      "Coverage",
      scopedXid(scope, testFile, testFile),
      { "Coverage.repo": scope.key, "Coverage.tool": "seed" },
    );
    const chunkUid = await upsertByXid(
      client,
      "TestChunk",
      scopedXid(scope, testFile),
      {
        "TestChunk.repo": scope.key,
        "TestChunk.file_path": testFile,
        "TestChunk.test_name": testFile,
        "TestChunk.coverage": { uid: coverageUid },
      },
    );

    expect(chunkUid).toBeTruthy();
    await replaceEdgeWithFacets(client, coverageUid, "Coverage.covers", [
      { uid: fileUid, facets: { ranges: covered.ranges } },
    ]);
  }

  it("returns the test whose coverage overlaps the asked-about line range", async () => {
    const scope = mainScope(`spec-trace/${randomUUID()}`);

    await seedCoverage(scope, { file: "src/widget.ts", ranges: "10-20" });

    expect(
      await testsCoveringInScope(client, scope, {
        file: "src/widget.ts",
        ranges: [[12, 14]],
      }),
    ).toEqual([{ testFile: "src/widget.test.ts", origin: "main" }]);
  });

  it("returns nothing for a range no test covers", async () => {
    const scope = mainScope(`spec-trace/${randomUUID()}`);

    await seedCoverage(scope, { file: "src/widget.ts", ranges: "10-20" });

    expect(
      await testsCoveringInScope(client, scope, {
        file: "src/widget.ts",
        ranges: [[80, 90]],
      }),
    ).toEqual([]);
  });

  it("returns every covering test when no range narrows the question", async () => {
    const scope = mainScope(`spec-trace/${randomUUID()}`);

    await seedCoverage(scope, { file: "src/widget.ts", ranges: "10-20" });

    expect(
      await testsCoveringInScope(client, scope, { file: "src/widget.ts" }),
    ).toHaveLength(1);
  });

  it("reads the branch's own coverage from the run scope and marks it as overlay", async () => {
    const repo = `spec-trace/${randomUUID()}`;
    const scope = overlayScope(repo, randomUUID());

    await seedCoverage(scope, { file: "src/widget.ts", ranges: "1-5" });

    expect(
      await testsCoveringInScope(client, scope, {
        file: "src/widget.ts",
        ranges: [[2, 3]],
      }),
    ).toEqual([{ testFile: "src/widget.test.ts", origin: "overlay" }]);
  });

  it("does not see the branch's coverage from the main scope", async () => {
    const repo = `spec-trace/${randomUUID()}`;

    await seedCoverage(overlayScope(repo, randomUUID()), {
      file: "src/widget.ts",
      ranges: "1-5",
    });

    expect(
      await testsCoveringInScope(client, mainScope(repo), {
        file: "src/widget.ts",
      }),
    ).toEqual([]);
  });
});
