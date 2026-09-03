import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { findRepoRoot } from "../lib/repo-root.js";
import { randomUUID } from "node:crypto";
import * as dgraph from "dgraph-js-http";
import { ingestTestReport } from "./ingest-test-report.js";
import { projectSpecFile } from "./project-spec-file.js";

const DGRAPH_HTTP = process.env.DGRAPH_HTTP ?? "http://localhost:8081";
const APPLIER = join(
  findRepoRoot(),
  "scripts",
  "infra",
  "setup-spec-trace-schema.sh",
);

async function dgraphReachable(): Promise<boolean> {
  try {
    return (
      await fetch(`${DGRAPH_HTTP}/health`, { signal: AbortSignal.timeout(800) })
    ).ok;
  } catch {
    return false;
  }
}

const reachable = await dgraphReachable();

describe.skipIf(!reachable)("ingestTestReport (live Dgraph)", () => {
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

  async function deleteRepoNodes(repo: string): Promise<void> {
    const txn = dgraphClient.newTxn();

    try {
      const res = await txn.queryWithVars(
        `query nodes($repo: string) {
          testchunks(func: eq(TestChunk.repo, $repo)) { uid }
          codechunks(func: eq(CodeChunk.repo, $repo)) { uid }
          coverages(func: eq(Coverage.repo, $repo)) { uid }
          testsuites(func: eq(TestSuite.repo, $repo)) { uid }
          specs(func: eq(Spec.repo, $repo)) { uid }
          statements(func: eq(Statement.repo, $repo)) { uid }
          blocks(func: eq(Block.repo, $repo)) { uid }
          files(func: eq(File.repo, $repo)) { uid }
          root(func: eq(Repo.xid, $repo)) { uid }
        }`,
        { $repo: repo },
      );
      const data = res.data as {
        testchunks?: { uid: string }[];
        codechunks?: { uid: string }[];
        coverages?: { uid: string }[];
        testsuites?: { uid: string }[];
        specs?: { uid: string }[];
        statements?: { uid: string }[];
        blocks?: { uid: string }[];
        files?: { uid: string }[];
        root?: { uid: string }[];
      };
      const uids = [
        ...(data.testchunks ?? []),
        ...(data.codechunks ?? []),
        ...(data.coverages ?? []),
        ...(data.testsuites ?? []),
        ...(data.specs ?? []),
        ...(data.statements ?? []),
        ...(data.blocks ?? []),
        ...(data.files ?? []),
        ...(data.root ?? []),
      ].map((node) => node.uid);

      if (uids.length) {
        await txn.mutate({
          deleteNquads: uids.map((uid) => `<${uid}> * * .`).join("\n"),
          commitNow: true,
        });
      }
    } catch {
      keepCleanupFromMaskingTheAssertion();
    } finally {
      await txn.discard().catch(() => {});
    }
  }

  function keepCleanupFromMaskingTheAssertion(): void {}

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
      keepCleanupFromMaskingTheAssertion();
    } finally {
      await txn.discard().catch(() => {});
    }
  }

  let createdRepo = "";
  let createdStatementXid = "";

  afterEach(async () => {
    if (createdRepo) {
      await deleteRepoNodes(createdRepo);
    }

    if (createdStatementXid) {
      await deleteStatementNode(createdStatementXid);
    }
    createdStatementXid = "";
  });

  it("attaches the report's TestChunks and TestSuites to the Repo root", async () => {
    const repo = `test-report/${randomUUID()}`;

    createdRepo = repo;

    const report = {
      tests: [
        {
          id: "shared/x.test.ts::a",
          name: "renders",
          file: "shared/x.test.ts",
          suite: ["Widget"],
        },
      ],
      results: [],
    };

    await ingestTestReport(dgraphClient, repo, report);

    const data = (await readGraph(
      `query q($repo: string){
        root(func: eq(Repo.xid, $repo)){
          tc: count(Repo.test_chunks)
          suites: Repo.test_suites { TestSuite.name }
        }
      }`,
      { $repo: repo },
    )) as {
      root?: Array<{
        tc?: number;
        suites?: Array<{ "TestSuite.name"?: string }>;
      }>;
    };

    expect(data.root?.[0]?.tc).toBeGreaterThanOrEqual(1);
    expect(
      (data.root?.[0]?.suites ?? []).map((s) => s["TestSuite.name"]),
    ).toEqual(["Widget"]);
  });

  it("links a statement via validated_by when a descriptor name sentence-matches its spec (no anchor)", async () => {
    const repo = `test-report/${randomUUID()}`;

    createdRepo = repo;
    const specPath = "specs/example/spec.md";

    await projectSpecFile(
      repo,
      specPath,
      "# Feature Specification: Widget Service\n\n## Requirements\n\n1. Onboarding a new repo produces a\n   PR within 5 minutes\n",
      dgraphClient,
      async () => null,
    );

    const report = {
      tests: [
        {
          id: "shared/x.test.ts",
          name: "Widget Service | Onboarding a new repo produces a PR within 5 minutes | produces a PR",
          file: "shared/x.test.ts",
        },
      ],
      results: [],
    };

    await ingestTestReport(dgraphClient, repo, report);

    const data = (await readGraph(
      `query q($sx: string) {
        stmt(func: eq(Statement.xid, $sx)) { Statement.validated_by { TestChunk.xid } }
      }`,
      { $sx: `${repo}|${specPath}|0` },
    )) as { stmt?: { "Statement.validated_by"?: Record<string, unknown>[] }[] };

    expect(data.stmt?.[0]?.["Statement.validated_by"]).toEqual([
      { "TestChunk.xid": `${repo}|shared/x.test.ts` },
    ]);
  });

  it("attaches validated_by to the file-scoped TestChunk for a per-it descriptor whose suite chain sentence-matches", async () => {
    const repo = `test-report/${randomUUID()}`;

    createdRepo = repo;
    const specPath = "specs/example/spec.md";

    await projectSpecFile(
      repo,
      specPath,
      "# Feature Specification: Widget Service\n\n## Requirements\n\n1. Onboarding a new repo produces a\n   PR within 5 minutes\n",
      dgraphClient,
      async () => null,
    );

    const report = {
      tests: [
        {
          id: "shared/x.test.ts::Widget Service > Onboarding > produces a PR",
          name: "produces a PR",
          file: "shared/x.test.ts",
          suite: [
            "Widget Service",
            "Onboarding a new repo produces a PR within 5 minutes",
          ],
        },
      ],
      results: [],
    };

    await ingestTestReport(dgraphClient, repo, report);

    const data = (await readGraph(
      `query q($sx: string) {
        stmt(func: eq(Statement.xid, $sx)) { Statement.validated_by { TestChunk.xid } }
      }`,
      { $sx: `${repo}|${specPath}|0` },
    )) as { stmt?: { "Statement.validated_by"?: Record<string, unknown>[] }[] };

    expect(data.stmt?.[0]?.["Statement.validated_by"]).toEqual([
      { "TestChunk.xid": `${repo}|shared/x.test.ts` },
    ]);
  });

  it("writes one TestChunk keyed repo|t1 with test_name/file_path/start_line/end_line for a single descriptor", async () => {
    const repo = `test-report/${randomUUID()}`;

    createdRepo = repo;
    const report = {
      tests: [
        {
          id: "t1",
          name: "renders a click",
          file: "test/widget.test.ts",
          startLine: 10,
          endLine: 25,
        },
      ],
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

  it("links the spec Statement to the file-scoped TestChunk via validated_by for a descriptor with spec anchor specs/foo/spec.md#7", async () => {
    const repo = `test-report/${randomUUID()}`;

    createdRepo = repo;
    const statementXid = `${repo}|specs/foo/spec.md|7`;

    createdStatementXid = statementXid;
    const report = {
      tests: [
        {
          id: "t1",
          name: "renders",
          file: "test/widget.test.ts",
          spec: "specs/foo/spec.md#7",
        },
      ],
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

    expect(data.stmt?.[0]?.["Statement.validated_by"]).toEqual([
      { "TestChunk.xid": `${repo}|test/widget.test.ts` },
    ]);
  });

  it("marks the spec Statement violated with a reason naming failing test renders when its result passed is false", async () => {
    const repo = `test-report/${randomUUID()}`;

    createdRepo = repo;
    const statementXid = `${repo}|specs/foo/spec.md|7`;

    createdStatementXid = statementXid;
    const report = {
      tests: [
        {
          id: "t1",
          name: "renders",
          file: "test/widget.test.ts",
          spec: "specs/foo/spec.md#7",
        },
      ],
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
        {
          id: "t1",
          name: "fails",
          file: "test/widget.test.ts",
          spec: "specs/foo/spec.md#7",
        },
        {
          id: "t2",
          name: "passes",
          file: "test/widget.test.ts",
          spec: "specs/foo/spec.md#7",
        },
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
    const descriptor = {
      id: "t1",
      name: "renders",
      file: "test/widget.test.ts",
      spec: "specs/foo/spec.md#7",
    };

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
    const descriptor = {
      id: "t1",
      name: "renders",
      file: "test/widget.test.ts",
      spec: "specs/foo/spec.md#7",
    };

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

  it("connects Statement to File via validated_by to TestChunk to coverage to covers, minting a CodeChunk for the covered range with no AST pre-seeding", async () => {
    const repo = `test-report/${randomUUID()}`;

    createdRepo = repo;
    const specPath = "specs/example/spec.md";

    await projectSpecFile(
      repo,
      specPath,
      "# Feature Specification: Widget Service\n\n## Requirements\n\n1. Onboarding a new repo produces a PR within 5 minutes\n",
      dgraphClient,
      async () => null,
    );
    await ingestTestReport(dgraphClient, repo, {
      tests: [
        {
          id: "a.test.ts::Widget Service > Onboarding > x",
          name: "x",
          file: "a.test.ts",
          suite: [
            "Widget Service",
            "Onboarding a new repo produces a PR within 5 minutes",
          ],
        },
      ],
      results: [
        {
          id: "a.test.ts::Widget Service > Onboarding > x",
          passed: true,
          covered: [{ file: "src/a.ts", startLine: 5, endLine: 10 }],
        },
      ],
    });

    const data = (await readGraph(
      `query q($sx: string) {
        stmt(func: eq(Statement.xid, $sx)) {
          Statement.validated_by { cov: TestChunk.coverage { covers: Coverage.covers { File.xid } } }
        }
      }`,
      { $sx: `${repo}|${specPath}|0` },
    )) as {
      stmt?: {
        "Statement.validated_by"?: {
          cov?: { covers?: Record<string, unknown>[] };
        }[];
      }[];
    };

    expect(
      data.stmt?.[0]?.["Statement.validated_by"]?.[0]?.cov?.covers,
    ).toEqual([{ "File.xid": `${repo}|src/a.ts` }]);
  });

  it("covers a File from result t1's covered range and links it via COVERS", async () => {
    const repo = `test-report/${randomUUID()}`;

    createdRepo = repo;
    const report = {
      tests: [{ id: "t1", name: "renders", file: "test/widget.test.ts" }],
      results: [
        {
          id: "t1",
          passed: true,
          covered: [{ file: "src/widget.ts", startLine: 5, endLine: 10 }],
        },
      ],
    };

    await ingestTestReport(dgraphClient, repo, report);

    const data = (await readGraph(
      `query q($xid: string) {
        cov(func: eq(Coverage.xid, $xid)) {
          Coverage.covers { File.xid }
        }
      }`,
      { $xid: `${repo}|test/widget.test.ts|test/widget.test.ts` },
    )) as { cov?: Record<string, unknown>[] };

    expect(data.cov?.[0]?.["Coverage.covers"]).toEqual([
      { "File.xid": `${repo}|src/widget.ts` },
    ]);
  });

  it("creates one Coverage node per file and attaches HAS_COVERAGE to the file-scoped TestChunk for many per-it descriptors", async () => {
    const repo = `test-report/${randomUUID()}`;

    createdRepo = repo;
    const report = {
      tests: [
        { id: "a.test.ts::A > x", name: "x", file: "a.test.ts", suite: ["A"] },
        { id: "a.test.ts::A > y", name: "y", file: "a.test.ts", suite: ["A"] },
      ],
      results: [
        {
          id: "a.test.ts::A > x",
          passed: true,
          covered: [{ file: "src/a.ts", startLine: 1, endLine: 2 }],
        },
        {
          id: "a.test.ts::A > y",
          passed: true,
          covered: [{ file: "src/a.ts", startLine: 1, endLine: 2 }],
        },
      ],
    };

    await ingestTestReport(dgraphClient, repo, report);

    const data = (await readGraph(
      `query q($r: string) {
        cov(func: eq(Coverage.repo, $r)) { uid }
        fileChunk(func: eq(TestChunk.xid, "${repo}|a.test.ts")) { hasCov: count(TestChunk.coverage) }
      }`,
      { $r: repo },
    )) as { cov?: { uid: string }[]; fileChunk?: { hasCov?: number }[] };

    expect(data.cov ?? []).toHaveLength(1);
    expect(data.fileChunk?.[0]?.hasCov).toBe(1);
  });

  it("links TestChunk repo|t1 to the innermost TestSuite Overview for a descriptor with suite [Overview]", async () => {
    const repo = `test-report/${randomUUID()}`;

    createdRepo = repo;
    const report = {
      tests: [
        {
          id: "t1",
          name: "renders a click",
          file: "test/widget.test.ts",
          suite: ["Overview"],
        },
      ],
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
      tests: [
        {
          id: "t1",
          name: "renders",
          file: "test/widget.test.ts",
          suite: ["Outer", "Inner"],
        },
      ],
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

  it("links an acceptance criterion via AcceptanceCriterion.validated_by when a descriptor sentence-matches it", async () => {
    const repo = `test-report/${randomUUID()}`;

    createdRepo = repo;
    const specPath = "specs/example/spec.md";

    await projectSpecFile(
      repo,
      specPath,
      "# Feature Specification: Widget Service\n\n## Acceptance Criteria\n\n1. Rollback completes within one minute\n",
      dgraphClient,
      async () => null,
    );

    const report = {
      tests: [
        {
          id: "shared/x.test.ts",
          name: "Widget Service | Rollback completes within one minute | rollback",
          file: "shared/x.test.ts",
        },
      ],
      results: [],
    };

    await ingestTestReport(dgraphClient, repo, report);

    const data = (await readGraph(
      `query q($xid: string) {
        ac(func: eq(AcceptanceCriterion.xid, $xid)) {
          AcceptanceCriterion.validated_by { TestChunk.xid }
        }
      }`,
      { $xid: `${repo}|${specPath}|ac|0` },
    )) as {
      ac?: { "AcceptanceCriterion.validated_by"?: Record<string, unknown>[] }[];
    };

    expect(data.ac?.[0]?.["AcceptanceCriterion.validated_by"]).toEqual([
      { "TestChunk.xid": `${repo}|shared/x.test.ts` },
    ]);
  });

  it("marks an acceptance criterion violated with a reason naming the failing test via the sentence path", async () => {
    const repo = `test-report/${randomUUID()}`;

    createdRepo = repo;
    const specPath = "specs/example/spec.md";

    await projectSpecFile(
      repo,
      specPath,
      "# Feature Specification: Widget Service\n\n## Acceptance Criteria\n\n1. Rollback completes within one minute\n",
      dgraphClient,
      async () => null,
    );

    const report = {
      tests: [
        {
          id: "shared/x.test.ts",
          name: "Widget Service | Rollback completes within one minute | rollback",
          file: "shared/x.test.ts",
        },
      ],
      results: [{ id: "shared/x.test.ts", passed: false, covered: [] }],
    };

    await ingestTestReport(dgraphClient, repo, report);

    const data = (await readGraph(
      `query q($xid: string) {
        ac(func: eq(AcceptanceCriterion.xid, $xid)) {
          AcceptanceCriterion.violated AcceptanceCriterion.violation_reason
        }
      }`,
      { $xid: `${repo}|${specPath}|ac|0` },
    )) as { ac?: Record<string, unknown>[] };

    expect(data.ac?.[0]?.["AcceptanceCriterion.violated"]).toBe(true);
    expect(data.ac?.[0]?.["AcceptanceCriterion.violation_reason"]).toContain(
      "rollback",
    );
  });
});
