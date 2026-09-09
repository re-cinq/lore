import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import * as dgraph from "dgraph-js-http";
import { findRepoRoot } from "../../lib/repo-root.js";
import { dgraphReachable } from "../../lib/dgraph-test-gate.js";
import { ingestSpecTrace } from "./ingest-spec-trace.js";
import { dropOverlay } from "./overlay.js";
import { preferOverlay, testsCoveringInScope } from "./tests-covering.js";
import {
  mainScope,
  overlayScope,
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

  function reportCovering(
    covered: { file: string; startLine: number; endLine: number },
    runId?: string,
  ) {
    return {
      commit: "sha",
      branch: "b",
      ...(runId ? { assemblyRunId: runId } : {}),
      tests: [
        {
          id: "src/widget.test.ts::adds",
          name: "adds",
          file: "src/widget.test.ts",
          startLine: 4,
          endLine: 9,
        },
      ],
      results: [
        { id: "src/widget.test.ts::adds", passed: true, covered: [covered] },
      ],
    };
  }

  it("returns the test whose coverage overlaps the asked-about line range", async () => {
    const repo = `spec-trace/${randomUUID()}`;

    await ingestSpecTrace(
      client,
      repo,
      "test-report",
      reportCovering({ file: "src/widget.ts", startLine: 10, endLine: 20 }),
    );

    expect(
      await testsCoveringInScope(client, mainScope(repo), {
        file: "src/widget.ts",
        ranges: [[12, 14]],
      }),
    ).toEqual([{ testFile: "src/widget.test.ts", origin: "main" }]);
  });

  it("returns nothing for a range no test covers", async () => {
    const repo = `spec-trace/${randomUUID()}`;

    await ingestSpecTrace(
      client,
      repo,
      "test-report",
      reportCovering({ file: "src/widget.ts", startLine: 10, endLine: 20 }),
    );

    expect(
      await testsCoveringInScope(client, mainScope(repo), {
        file: "src/widget.ts",
        ranges: [[80, 90]],
      }),
    ).toEqual([]);
  });

  it("returns every covering test when no range narrows the question", async () => {
    const repo = `spec-trace/${randomUUID()}`;

    await ingestSpecTrace(
      client,
      repo,
      "test-report",
      reportCovering({ file: "src/widget.ts", startLine: 10, endLine: 20 }),
    );

    expect(
      await testsCoveringInScope(client, mainScope(repo), {
        file: "src/widget.ts",
      }),
    ).toHaveLength(1);
  });

  it("reads the branch's own coverage from the run scope and marks it as overlay", async () => {
    const repo = `spec-trace/${randomUUID()}`;
    const runId = randomUUID();

    await ingestSpecTrace(
      client,
      repo,
      "test-report",
      reportCovering(
        { file: "src/widget.ts", startLine: 1, endLine: 5 },
        runId,
      ),
    );

    expect(
      await testsCoveringInScope(client, overlayScope(repo, runId), {
        file: "src/widget.ts",
        ranges: [[2, 3]],
      }),
    ).toEqual([{ testFile: "src/widget.test.ts", origin: "overlay" }]);

    await dropOverlay(client, repo, runId);
  });

  it("does not see the branch's coverage from the main scope", async () => {
    const repo = `spec-trace/${randomUUID()}`;
    const runId = randomUUID();

    await ingestSpecTrace(
      client,
      repo,
      "test-report",
      reportCovering(
        { file: "src/widget.ts", startLine: 1, endLine: 5 },
        runId,
      ),
    );

    expect(
      await testsCoveringInScope(client, mainScope(repo), {
        file: "src/widget.ts",
      }),
    ).toEqual([]);

    await dropOverlay(client, repo, runId);
  });
});
