import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { findRepoRoot } from "../lib/repo-root.js";
import { randomUUID } from "node:crypto";
import * as dgraph from "dgraph-js-http";
import { ingestSpecTrace } from "./ingest-spec-trace.js";
import { makeDeleteRepoNodes } from "./test-helpers/delete-repo-nodes.js";
import { dgraphReachable } from "../lib/dgraph-test-gate.js";

const DGRAPH_HTTP = process.env.DGRAPH_HTTP ?? "http://localhost:8081";
const APPLIER = join(
  findRepoRoot(),
  "scripts",
  "infra",
  "setup-spec-trace-schema.sh",
);

const reachable = await dgraphReachable();

describe.skipIf(!reachable)("ingestSpecTrace (live Dgraph)", () => {
  const dgraphClient = new dgraph.DgraphClient(
    new dgraph.DgraphClientStub(DGRAPH_HTTP),
  );

  beforeAll(() => {
    execFileSync("bash", [APPLIER], {
      env: { ...process.env, DGRAPH_HTTP },
      stdio: "pipe",
    });
  });

  async function readGraph(
    query: string,
    vars: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const txn = dgraphClient.newTxn();

    try {
      const res = await txn.queryWithVars(query, vars);

      return (res.data ?? {}) as Record<string, unknown>;
    } finally {
      await txn.discard().catch(() => {});
    }
  }

  const deleteRepoNodes = makeDeleteRepoNodes(dgraphClient, [
    { alias: "testchunks", type: "TestChunk" },
    { alias: "codechunks", type: "CodeChunk" },
    { alias: "coverages", type: "Coverage" },
    { alias: "testsuites", type: "TestSuite" },
  ]);

  let createdRepo = "";

  afterEach(async () => {
    if (createdRepo) {
      await deleteRepoNodes(createdRepo);
    }
  });

  it("writes a TestChunk via ingestTestReport when kind is test-report", async () => {
    const repo = `spec-trace/${randomUUID()}`;

    createdRepo = repo;

    await ingestSpecTrace(dgraphClient, repo, "test-report", {
      tests: [
        {
          id: "t1",
          name: "renders",
          file: "test/widget.test.ts",
          startLine: 10,
          endLine: 25,
        },
      ],
      results: [],
    });

    const graph = (await readGraph(
      `query q($xid: string) {
        tc(func: eq(TestChunk.xid, $xid)) {
          TestChunk.xid TestChunk.repo TestChunk.test_name TestChunk.file_path
        }
      }`,
      { $xid: `${repo}|t1` },
    )) as { tc?: Record<string, unknown>[] };

    expect(graph.tc?.[0]).toMatchObject({
      "TestChunk.xid": `${repo}|t1`,
      "TestChunk.repo": repo,
      "TestChunk.test_name": "renders",
      "TestChunk.file_path": "test/widget.test.ts",
    });
  });

  it("writes Coverage with a COVERS edge to a File node via ingestCoverageReport when kind is coverage, with no pre-seeding or AST", async () => {
    const repo = `spec-trace/${randomUUID()}`;

    createdRepo = repo;

    await ingestSpecTrace(dgraphClient, repo, "coverage", {
      commit: "abc",
      coverage: [
        {
          test: "covers widget",
          covered: [{ file: "src/widget.ts", startLine: 5, endLine: 10 }],
        },
      ],
    });

    const graph = (await readGraph(
      `query q($repo: string) {
        cov(func: eq(Coverage.repo, $repo)) {
          Coverage.covers { File.xid }
        }
      }`,
      { $repo: repo },
    )) as { cov?: Record<string, unknown>[] };

    expect(graph.cov?.[0]?.["Coverage.covers"]).toEqual([
      { "File.xid": `${repo}|src/widget.ts` },
    ]);
  });
});
