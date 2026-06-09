import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import * as dgraph from "dgraph-js-http";
import { ingestTestReport } from "../ingest-test-report.js";

/**
 * ingestTestReport (spec-traceability-graph, Phase 6 / T260) — consumes the
 * project-test-interface's POSTED test-report payload and writes the graph
 * against the REAL local Dgraph cluster (no mocks). Container-gated: skips when
 * Dgraph isn't reachable.
 *
 * KERNEL facet: one TestDescriptor → one TestChunk keyed by `${repo}|${id}`,
 * carrying repo / test_name / file_path / start_line / end_line. validated_by,
 * Coverage nodes, COVERS edges, and violated accounting are LATER facets.
 */

const DGRAPH_HTTP = process.env.DGRAPH_HTTP ?? "http://localhost:8081";
const REPO_ROOT = join(process.cwd(), "..");
const APPLIER = join(REPO_ROOT, "scripts", "infra", "setup-spec-trace-schema.sh");

async function dgraphReachable(): Promise<boolean> {
  try {
    return (await fetch(`${DGRAPH_HTTP}/health`, { signal: AbortSignal.timeout(800) })).ok;
  } catch {
    return false;
  }
}

const reachable = await dgraphReachable();

describe.skipIf(!reachable)("ingestTestReport (live Dgraph)", () => {
  const dgraphClient = new dgraph.DgraphClient(new dgraph.DgraphClientStub(DGRAPH_HTTP));

  beforeAll(() => {
    execFileSync("bash", [APPLIER], { env: { ...process.env, DGRAPH_HTTP }, stdio: "pipe" });
  });

  async function readGraph(query: string, vars: Record<string, string>): Promise<Record<string, unknown>> {
    const txn = dgraphClient.newTxn();
    try {
      const res = await txn.queryWithVars(query, vars);
      return (res.data ?? {}) as Record<string, unknown>;
    } finally {
      await txn.discard().catch(() => {});
    }
  }

  async function deleteRepoNodes(repo: string): Promise<void> {
    const txn = dgraphClient.newTxn();
    try {
      const res = await txn.queryWithVars(
        `query nodes($repo: string) {
          testchunks(func: eq(TestChunk.repo, $repo)) { uid }
          codechunks(func: eq(CodeChunk.repo, $repo)) { uid }
          coverages(func: eq(Coverage.repo, $repo)) { uid }
          testsuites(func: eq(TestSuite.repo, $repo)) { uid }
        }`,
        { $repo: repo },
      );
      const data = res.data as {
        testchunks?: { uid: string }[];
        codechunks?: { uid: string }[];
        coverages?: { uid: string }[];
        testsuites?: { uid: string }[];
      };
      const uids = [
        ...(data.testchunks ?? []),
        ...(data.codechunks ?? []),
        ...(data.coverages ?? []),
        ...(data.testsuites ?? []),
      ].map((node) => node.uid);
      if (uids.length) {
        await txn.mutate({
          deleteNquads: uids.map((uid) => `<${uid}> * * .`).join("\n"),
          commitNow: true,
        });
      }
    } catch {
      // best-effort cleanup must never mask the assertion
    } finally {
      await txn.discard().catch(() => {});
    }
  }

  async function deleteStatementNode(statementXid: string): Promise<void> {
    const txn = dgraphClient.newTxn();
    try {
      const res = await txn.queryWithVars(
        `query stmt($sx: string) {
          stmts(func: eq(Statement.xid, $sx)) { uid }
        }`,
        { $sx: statementXid },
      );
      const data = res.data as { stmts?: { uid: string }[] };
      const uids = (data.stmts ?? []).map((node) => node.uid);
      if (uids.length) {
        await txn.mutate({
          deleteNquads: uids.map((uid) => `<${uid}> * * .`).join("\n"),
          commitNow: true,
        });
      }
    } catch {
      // best-effort cleanup must never mask the assertion
    } finally {
      await txn.discard().catch(() => {});
    }
  }

  let createdRepo = "";
  let createdStatementXid = "";
  afterEach(async () => {
    if (createdRepo) await deleteRepoNodes(createdRepo);
    if (createdStatementXid) await deleteStatementNode(createdStatementXid);
    createdStatementXid = "";
  });

  it("writes one TestChunk keyed repo|t1 with test_name/file_path/start_line/end_line for a single descriptor", async () => {
    const repo = `test-report/${randomUUID()}`;
    createdRepo = repo;
    const report = {
      tests: [{ id: "t1", name: "renders a click", file: "test/widget.test.ts", startLine: 10, endLine: 25 }],
      results: [],
    };

    await ingestTestReport(dgraphClient, repo, report);

    const data = (await readGraph(
      `query q($xid: string) {
        tc(func: eq(TestChunk.xid, $xid)) {
          TestChunk.xid TestChunk.repo TestChunk.test_name TestChunk.file_path TestChunk.start_line TestChunk.end_line
        }
      }`,
      { $xid: `${repo}|t1` },
    )) as { tc?: Record<string, unknown>[] };

    expect(data.tc?.[0]).toMatchObject({
      "TestChunk.xid": `${repo}|t1`,
      "TestChunk.repo": repo,
      "TestChunk.test_name": "renders a click",
      "TestChunk.file_path": "test/widget.test.ts",
      "TestChunk.start_line": 10,
      "TestChunk.end_line": 25,
    });
  });

  it("links the spec Statement to TestChunk repo|t1 via validated_by for a descriptor with spec anchor specs/foo/spec.md#7", async () => {
    const repo = `test-report/${randomUUID()}`;
    createdRepo = repo;
    const statementXid = `${repo}|specs/foo/spec.md|7`;
    createdStatementXid = statementXid;
    const report = {
      tests: [{ id: "t1", name: "renders", file: "test/widget.test.ts", spec: "specs/foo/spec.md#7" }],
      results: [],
    };

    await ingestTestReport(dgraphClient, repo, report);

    const data = (await readGraph(
      `query q($sx: string) {
        stmt(func: eq(Statement.xid, $sx)) {
          Statement.validated_by { TestChunk.xid }
        }
      }`,
      { $sx: statementXid },
    )) as { stmt?: Record<string, unknown>[] };

    expect(data.stmt?.[0]?.["Statement.validated_by"]).toEqual([{ "TestChunk.xid": `${repo}|t1` }]);
  });

  it("marks the spec Statement violated with a reason naming failing test renders when its result passed is false", async () => {
    const repo = `test-report/${randomUUID()}`;
    createdRepo = repo;
    const statementXid = `${repo}|specs/foo/spec.md|7`;
    createdStatementXid = statementXid;
    const report = {
      tests: [{ id: "t1", name: "renders", file: "test/widget.test.ts", spec: "specs/foo/spec.md#7" }],
      results: [{ id: "t1", passed: false, covered: [] }],
    };

    await ingestTestReport(dgraphClient, repo, report);

    const data = (await readGraph(
      `query q($sx: string) {
        stmt(func: eq(Statement.xid, $sx)) {
          Statement.violated Statement.violation_reason
        }
      }`,
      { $sx: statementXid },
    )) as { stmt?: Record<string, unknown>[] };

    expect(data.stmt?.[0]?.["Statement.violated"]).toBe(true);
    expect(data.stmt?.[0]?.["Statement.violation_reason"]).toContain("renders");
  });

  it("keeps the spec Statement violated when one of two validating tests fails and the other passes", async () => {
    const repo = `test-report/${randomUUID()}`;
    createdRepo = repo;
    const statementXid = `${repo}|specs/foo/spec.md|7`;
    createdStatementXid = statementXid;
    const report = {
      tests: [
        { id: "t1", name: "fails", file: "test/widget.test.ts", spec: "specs/foo/spec.md#7" },
        { id: "t2", name: "passes", file: "test/widget.test.ts", spec: "specs/foo/spec.md#7" },
      ],
      results: [
        { id: "t1", passed: false, covered: [] },
        { id: "t2", passed: true, covered: [] },
      ],
    };

    await ingestTestReport(dgraphClient, repo, report);

    const data = (await readGraph(
      `query q($sx: string) {
        stmt(func: eq(Statement.xid, $sx)) {
          Statement.violated
        }
      }`,
      { $sx: statementXid },
    )) as { stmt?: Record<string, unknown>[] };

    expect(data.stmt?.[0]?.["Statement.violated"]).toBe(true);
  });

  it("clears the spec Statement violated to false when a re-ingest reports the validating test passed", async () => {
    const repo = `test-report/${randomUUID()}`;
    createdRepo = repo;
    const statementXid = `${repo}|specs/foo/spec.md|7`;
    createdStatementXid = statementXid;
    const descriptor = { id: "t1", name: "renders", file: "test/widget.test.ts", spec: "specs/foo/spec.md#7" };

    await ingestTestReport(dgraphClient, repo, {
      tests: [descriptor],
      results: [{ id: "t1", passed: false, covered: [] }],
    });
    await ingestTestReport(dgraphClient, repo, {
      tests: [descriptor],
      results: [{ id: "t1", passed: true, covered: [] }],
    });

    const data = (await readGraph(
      `query q($sx: string) {
        stmt(func: eq(Statement.xid, $sx)) {
          Statement.violated
        }
      }`,
      { $sx: statementXid },
    )) as { stmt?: Record<string, unknown>[] };

    expect(data.stmt?.[0]?.["Statement.violated"]).toBe(false);
  });

  it("clears the spec Statement violation_reason when a re-ingest reports the validating test passed", async () => {
    const repo = `test-report/${randomUUID()}`;
    createdRepo = repo;
    const statementXid = `${repo}|specs/foo/spec.md|7`;
    createdStatementXid = statementXid;
    const descriptor = { id: "t1", name: "renders", file: "test/widget.test.ts", spec: "specs/foo/spec.md#7" };

    await ingestTestReport(dgraphClient, repo, {
      tests: [descriptor],
      results: [{ id: "t1", passed: false, covered: [] }],
    });
    await ingestTestReport(dgraphClient, repo, {
      tests: [descriptor],
      results: [{ id: "t1", passed: true, covered: [] }],
    });

    const data = (await readGraph(
      `query q($sx: string) {
        stmt(func: eq(Statement.xid, $sx)) {
          Statement.violation_reason
        }
      }`,
      { $sx: statementXid },
    )) as { stmt?: Record<string, unknown>[] };

    expect(data.stmt?.[0]?.["Statement.violation_reason"]).toBeUndefined();
  });

  it("covers CodeChunk repo|ccX from result t1's range 5-10 overlapping the chunk's 1-20 span", async () => {
    const repo = `test-report/${randomUUID()}`;
    createdRepo = repo;
    await dgraphClient.newTxn().mutate({
      setJson: {
        "dgraph.type": "CodeChunk",
        "CodeChunk.xid": `${repo}|ccX`,
        "CodeChunk.repo": repo,
        "CodeChunk.file_path": "src/widget.ts",
        "CodeChunk.start_line": 1,
        "CodeChunk.end_line": 20,
      },
      commitNow: true,
    });
    const report = {
      tests: [{ id: "t1", name: "renders", file: "test/widget.test.ts" }],
      results: [{ id: "t1", passed: true, covered: [{ file: "src/widget.ts", startLine: 5, endLine: 10 }] }],
    };

    await ingestTestReport(dgraphClient, repo, report);

    const data = (await readGraph(
      `query q($xid: string) {
        cov(func: eq(Coverage.xid, $xid)) {
          Coverage.covers { CodeChunk.xid }
        }
      }`,
      { $xid: `${repo}|test/widget.test.ts|renders` },
    )) as { cov?: Record<string, unknown>[] };

    expect(data.cov?.[0]?.["Coverage.covers"]).toEqual([{ "CodeChunk.xid": `${repo}|ccX` }]);
  });

  it("links TestChunk repo|t1 to the innermost TestSuite Overview for a descriptor with suite [Overview]", async () => {
    const repo = `test-report/${randomUUID()}`;
    createdRepo = repo;
    const report = {
      tests: [{ id: "t1", name: "renders a click", file: "test/widget.test.ts", suite: ["Overview"] }],
      results: [],
    };

    await ingestTestReport(dgraphClient, repo, report);

    const data = (await readGraph(
      `query q($xid: string) {
        tc(func: eq(TestChunk.xid, $xid)) {
          TestChunk.suite { TestSuite.xid TestSuite.name TestSuite.file_path }
        }
      }`,
      { $xid: `${repo}|t1` },
    )) as { tc?: Record<string, unknown>[] };

    expect(data.tc?.[0]?.["TestChunk.suite"]).toEqual({
      "TestSuite.xid": `${repo}|test/widget.test.ts|Overview`,
      "TestSuite.name": "Overview",
      "TestSuite.file_path": "test/widget.test.ts",
    });
  });

  it("nests TestSuites parent-linked outer to inner with TestChunk pointing at the innermost", async () => {
    const repo = `test-report/${randomUUID()}`;
    createdRepo = repo;
    const report = {
      tests: [{ id: "t1", name: "renders", file: "test/widget.test.ts", suite: ["Outer", "Inner"] }],
      results: [],
    };

    await ingestTestReport(dgraphClient, repo, report);

    const data = (await readGraph(
      `query q($xid: string) {
        tc(func: eq(TestChunk.xid, $xid)) {
          TestChunk.suite {
            TestSuite.xid TestSuite.name
            TestSuite.parent { TestSuite.xid TestSuite.name }
          }
        }
      }`,
      { $xid: `${repo}|t1` },
    )) as { tc?: Record<string, unknown>[] };

    expect(data.tc?.[0]?.["TestChunk.suite"]).toEqual({
      "TestSuite.xid": `${repo}|test/widget.test.ts|Outer>Inner`,
      "TestSuite.name": "Inner",
      "TestSuite.parent": {
        "TestSuite.xid": `${repo}|test/widget.test.ts|Outer`,
        "TestSuite.name": "Outer",
      },
    });
  });
});
