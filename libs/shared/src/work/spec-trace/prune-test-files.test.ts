import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { findRepoRoot } from "../../lib/repo-root.js";
import { randomUUID } from "node:crypto";
import * as dgraph from "dgraph-js-http";
import { ingestTestReport } from "./ingest-test-report.js";
import { projectSpecFile } from "./project-spec-file.js";
import { listTestFilePaths, pruneTestFiles } from "./prune-test-files.js";
import { dropOverlay } from "./overlay.js";
import { dgraphReachable } from "../../lib/dgraph-test-gate.js";

const DGRAPH_HTTP = process.env.DGRAPH_HTTP ?? "http://localhost:8081";

import {
  mainScope,
  overlayScope,
} from "../../domain/spec-trace/trace-scope.js";

const APPLIER = join(
  findRepoRoot(),
  "scripts",
  "infra",
  "setup-spec-trace-schema.sh",
);

const reachable = await dgraphReachable();

describe.skipIf(!reachable)(
  "pruneTestFiles — deletion half of incremental CI ingest, specs/ci-incremental-ingest FR4 (live Dgraph)",
  () => {
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
      const txn = dgraphClient.newTxn({ readOnly: true });
      const res = await txn.queryWithVars(query, vars);

      return res.data as Record<string, unknown>;
    }

    let createdRepo = "";

    afterEach(async () => {
      if (!createdRepo) {
        return;
      }
      const txn = dgraphClient.newTxn({ readOnly: true });
      const res = await txn.queryWithVars(
        `query q($repo: string) {
        chunks(func: eq(TestChunk.repo, $repo)) { uid }
        suites(func: eq(TestSuite.repo, $repo)) { uid }
        specs(func: eq(Spec.repo, $repo)) { uid }
        stmts(func: eq(Statement.repo, $repo)) { uid }
        cov(func: eq(Coverage.repo, $repo)) { uid }
        code(func: eq(CodeChunk.repo, $repo)) { uid }
        roots(func: eq(Repo.xid, $repo)) { uid }
      }`,
        { $repo: createdRepo },
      );
      const uids = Object.values(
        res.data as Record<string, Array<{ uid: string }>>,
      )
        .flat()
        .map((n) => n.uid);

      if (uids.length > 0) {
        await dgraphClient.newTxn().mutate({
          deleteNquads: uids.map((uid) => `<${uid}> * * .`).join("\n"),
          commitNow: true,
        });
      }
      createdRepo = "";
    });

    function seedReport() {
      return {
        commit: "c0ffee",
        tests: [
          {
            id: "src/a.test.ts::t1",
            name: "adds numbers",
            file: "src/a.test.ts",
            suite: ["adder"],
          },
          {
            id: "src/b.test.ts::t2",
            name: "subtracts numbers",
            file: "src/b.test.ts",
          },
        ],
        results: [
          {
            id: "src/a.test.ts::t1",
            passed: true,
            covered: [{ file: "src/a.ts", startLine: 1, endLine: 5 }],
          },
          { id: "src/b.test.ts::t2", passed: true, covered: [] },
        ],
      };
    }

    it("prunes every TestChunk and TestSuite of the named files and keeps the rest", async () => {
      const repo = `prune-tests/${randomUUID()}`;

      createdRepo = repo;
      await ingestTestReport(dgraphClient, mainScope(repo), seedReport());

      await pruneTestFiles(dgraphClient, repo, ["src/a.test.ts"]);

      const graph = (await readGraph(
        `query q($repo: string) {
        chunks(func: eq(TestChunk.repo, $repo)) { TestChunk.file_path }
        suites(func: eq(TestSuite.repo, $repo)) { TestSuite.name }
        root(func: eq(Repo.xid, $repo)) {
          kept: Repo.test_chunks { TestChunk.file_path }
        }
      }`,
        { $repo: repo },
      )) as {
        chunks?: Array<{ "TestChunk.file_path": string }>;
        suites?: Array<{ "TestSuite.name": string }>;
        root?: Array<{ kept?: Array<{ "TestChunk.file_path": string }> }>;
      };
      const files = (graph.chunks ?? []).map((c) => c["TestChunk.file_path"]);

      expect(files.some((f) => f === "src/a.test.ts")).toBe(false);
      expect(files.some((f) => f === "src/b.test.ts")).toBe(true);
      expect(graph.suites ?? []).toEqual([]);
      const kept = (graph.root?.[0]?.kept ?? []).map(
        (c) => c["TestChunk.file_path"],
      );

      expect(kept.some((f) => f === "src/a.test.ts")).toBe(false);
      expect(kept.some((f) => f === "src/b.test.ts")).toBe(true);
    });

    function renamedReport() {
      return {
        commit: "c0ffee2",
        tests: [
          {
            id: "src/a.test.ts::t1-renamed",
            name: "sums numbers",
            file: "src/a.test.ts",
            suite: ["summer"],
          },
        ],
        results: [
          {
            id: "src/a.test.ts::t1-renamed",
            passed: true,
            covered: [{ file: "src/new.ts", startLine: 1, endLine: 5 }],
          },
        ],
      };
    }

    const rowsOf = <T>(graph: Record<string, unknown>, key: string) =>
      (graph[key] ?? []) as T[];

    async function renameOutcome(repo: string) {
      const graph = await readGraph(
        `query q($repo: string, $file: string) {
        chunks(func: eq(TestChunk.repo, $repo)) @filter(eq(TestChunk.file_path, $file)) { title: TestChunk.test_name }
        cov(func: eq(Coverage.repo, $repo)) { xid: Coverage.xid }
        files(func: eq(File.repo, $repo)) { path: File.path }
        root(func: eq(Repo.xid, $repo)) {
          chunks: count(Repo.test_chunks)
          coverage: count(Repo.coverage)
        }
        allChunks(func: eq(TestChunk.repo, $repo)) { uid }
      }`,
        { $repo: repo, $file: "src/a.test.ts" },
      );
      const cov = rowsOf<{ xid: string }>(graph, "cov");

      return {
        titles: rowsOf<{ title: string }>(graph, "chunks")
          .map((row) => row.title)
          .sort(),
        oldCoverage: cov.filter((row) => row.xid.includes("adds numbers")),
        files: rowsOf<{ path: string }>(graph, "files")
          .map((row) => row.path)
          .sort(),
        rootEdges: rowsOf(graph, "root"),
        rows: {
          chunks: rowsOf(graph, "allChunks").length,
          coverage: cov.length,
        },
      };
    }

    it("leaves only the new title under src/a.test.ts after a rename, with no coverage on the old one", async () => {
      const repo = `prune-tests/${randomUUID()}`;

      createdRepo = repo;
      await ingestTestReport(dgraphClient, mainScope(repo), seedReport());
      await ingestTestReport(dgraphClient, mainScope(repo), renamedReport());

      const outcome = await renameOutcome(repo);

      expect(outcome).toEqual({
        titles: ["src/a.test.ts", "sums numbers"],
        oldCoverage: [],
        files: ["src/new.ts"],
        rootEdges: [outcome.rows],
        rows: outcome.rows,
      });
    });

    it("drops the renamed suite and leaves src/b.test.ts, which the second report does not carry, alone", async () => {
      const repo = `prune-tests/${randomUUID()}`;

      createdRepo = repo;
      await ingestTestReport(dgraphClient, mainScope(repo), seedReport());
      await ingestTestReport(dgraphClient, mainScope(repo), renamedReport());

      const graph = (await readGraph(
        `query q($repo: string, $file: string) {
        suites(func: eq(TestSuite.repo, $repo)) { TestSuite.name }
        other(func: eq(TestChunk.repo, $repo)) @filter(eq(TestChunk.file_path, $file)) { TestChunk.test_name }
      }`,
        { $repo: repo, $file: "src/b.test.ts" },
      )) as {
        suites?: Array<{ "TestSuite.name": string }>;
        other?: Array<{ "TestChunk.test_name": string }>;
      };

      expect((graph.suites ?? []).map((n) => n["TestSuite.name"])).toEqual([
        "summer",
      ]);
      expect(
        (graph.other ?? []).map((n) => n["TestChunk.test_name"]).sort(),
      ).toEqual(["src/b.test.ts", "subtracts numbers"]);
    });

    it("keeps a statement's validated_by edge to src/a.test.ts through a rename of the test in it", async () => {
      const repo = `prune-tests/${randomUUID()}`;

      createdRepo = repo;
      await projectSpecFile(
        {
          repo,
          filePath: "specs/adder/spec.md",
          content:
            "# Feature Specification: Adder\n\n## Requirements\n\n1. Adds numbers. ([validated by](src/a.test.ts#L1))\n",
        },
        dgraphClient,
        { embed: async (texts) => texts.map(() => null) },
      );
      await ingestTestReport(dgraphClient, mainScope(repo), seedReport());
      await ingestTestReport(dgraphClient, mainScope(repo), renamedReport());

      const graph = (await readGraph(
        `query q($repo: string) {
        stmts(func: eq(Statement.repo, $repo)) @filter(has(Statement.validated_by)) {
          Statement.validated_by { TestChunk.file_path }
        }
      }`,
        { $repo: repo },
      )) as {
        stmts?: Array<{
          "Statement.validated_by": Array<{ "TestChunk.file_path": string }>;
        }>;
      };

      expect(graph.stmts?.[0]?.["Statement.validated_by"]).toEqual([
        { "TestChunk.file_path": "src/a.test.ts" },
      ]);
    });

    it("replaces a rename inside the feat/x overlay and leaves main's row for the same file alone", async () => {
      const repo = `prune-tests/${randomUUID()}`;
      const scope = overlayScope(repo, "feat/x");

      createdRepo = repo;
      await ingestTestReport(dgraphClient, mainScope(repo), seedReport());
      await ingestTestReport(dgraphClient, scope, seedReport());
      await ingestTestReport(dgraphClient, scope, renamedReport());

      const graph = (await readGraph(
        `query q($repo: string, $overlay: string, $file: string) {
        main(func: eq(TestChunk.repo, $repo)) @filter(eq(TestChunk.file_path, $file)) { TestChunk.test_name }
        overlay(func: eq(TestChunk.repo, $overlay)) @filter(eq(TestChunk.file_path, $file)) { uid TestChunk.test_name }
      }`,
        { $repo: repo, $overlay: scope.key, $file: "src/a.test.ts" },
      )) as {
        main?: Array<{ "TestChunk.test_name": string }>;
        overlay?: Array<{ uid: string; "TestChunk.test_name": string }>;
      };

      await dropOverlay(dgraphClient, repo, "feat/x");

      expect(
        (graph.main ?? []).map((n) => n["TestChunk.test_name"]).sort(),
      ).toEqual(["adds numbers", "src/a.test.ts"]);
      expect(
        (graph.overlay ?? []).map((n) => n["TestChunk.test_name"]).sort(),
      ).toEqual(["src/a.test.ts", "sums numbers"]);
    });

    it("names src/a.test.ts and src/b.test.ts once each from the graph's rows", async () => {
      const repo = `prune-tests/${randomUUID()}`;

      createdRepo = repo;
      await ingestTestReport(dgraphClient, mainScope(repo), seedReport());

      const files = await listTestFilePaths(dgraphClient, repo);

      expect([...files].sort()).toEqual(["src/a.test.ts", "src/b.test.ts"]);
    });

    it("prunes the pruned file's Coverage nodes and garbage-collects code chunks nobody else owns", async () => {
      const repo = `prune-tests/${randomUUID()}`;

      createdRepo = repo;
      await ingestTestReport(dgraphClient, mainScope(repo), seedReport());

      await pruneTestFiles(dgraphClient, repo, ["src/a.test.ts"]);

      const graph = (await readGraph(
        `query q($repo: string) {
        cov(func: eq(Coverage.repo, $repo)) { Coverage.xid }
        code(func: eq(CodeChunk.repo, $repo)) { CodeChunk.file_path }
      }`,
        { $repo: repo },
      )) as {
        cov?: Array<{ "Coverage.xid": string }>;
        code?: Array<{ "CodeChunk.file_path": string }>;
      };
      const covXids = (graph.cov ?? []).map((c) => c["Coverage.xid"]);

      expect(covXids.some((graph) => graph.includes("src/a.test.ts"))).toBe(
        false,
      );
      expect(covXids.some((graph) => graph.includes("src/b.test.ts"))).toBe(
        true,
      );
      expect(graph.code ?? []).toEqual([]);
    });

    it("leaves no dangling Repo.coverage edge to a pruned Coverage node (delete-nquads drops only outgoing edges)", async () => {
      const repo = `prune-tests/${randomUUID()}`;

      createdRepo = repo;
      await ingestTestReport(dgraphClient, mainScope(repo), seedReport());

      await pruneTestFiles(dgraphClient, repo, ["src/a.test.ts"]);

      const graph = (await readGraph(
        `query q($repo: string) {
        root(func: eq(Repo.xid, $repo)) { edges: count(Repo.coverage) }
        cov(func: eq(Coverage.repo, $repo)) { uid }
      }`,
        { $repo: repo },
      )) as {
        root?: Array<{ edges?: number }>;
        cov?: Array<{ uid: string }>;
      };

      expect(graph.root?.[0]?.edges ?? 0).toBe((graph.cov ?? []).length);
    });

    it("keeps a statement the pruned test validated, dropping only the validated_by edge", async () => {
      const repo = `prune-tests/${randomUUID()}`;

      createdRepo = repo;
      await projectSpecFile(
        {
          repo,
          filePath: "specs/adder/spec.md",
          content:
            "# Feature Specification: Adder\n\n## Requirements\n\n1. Adds numbers. ([validated by](src/a.test.ts#L1))\n",
        },
        dgraphClient,
        { embed: async (texts) => texts.map(() => null) },
      );
      await ingestTestReport(dgraphClient, mainScope(repo), seedReport());

      await pruneTestFiles(dgraphClient, repo, ["src/a.test.ts"]);

      const graph = (await readGraph(
        `query q($repo: string) {
        stmts(func: eq(Statement.repo, $repo)) {
          Statement.text
          links: count(Statement.validated_by)
        }
      }`,
        { $repo: repo },
      )) as {
        stmts?: Array<{ "Statement.text"?: string; links?: number }>;
      };

      expect(graph.stmts?.length).toBeGreaterThanOrEqual(1);

      for (const stmt of graph.stmts ?? []) {
        expect(stmt.links ?? 0).toBe(0);
      }
    });

    it("a file with no graph presence prunes as a no-op", async () => {
      const repo = `prune-tests/${randomUUID()}`;

      createdRepo = repo;
      await ingestTestReport(dgraphClient, mainScope(repo), seedReport());

      await pruneTestFiles(dgraphClient, repo, ["src/never-existed.test.ts"]);

      const graph = (await readGraph(
        `query q($repo: string) {
        chunks(func: eq(TestChunk.repo, $repo)) { uid }
      }`,
        { $repo: repo },
      )) as { chunks?: Array<{ uid: string }> };

      expect((graph.chunks ?? []).length).toBeGreaterThanOrEqual(4);
    });
  },
);
