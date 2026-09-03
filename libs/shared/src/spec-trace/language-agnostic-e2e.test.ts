import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { findRepoRoot } from "../lib/repo-root.js";
import { randomUUID } from "node:crypto";
import * as dgraph from "dgraph-js-http";
import { projectSpecFile } from "./project-spec-file.js";
import { ingestCoverageReport } from "./ingest-coverage.js";
import { driftCheckFile } from "./drift-check-file.js";

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

describe.skipIf(!reachable)(
  "language-agnostic e2e: no tree-sitter grammar (Ruby)",
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
          specs(func: eq(Spec.repo, $repo)) { uid }
          root(func: eq(Repo.xid, $repo)) { uid }
          blocks(func: eq(Block.repo, $repo)) { uid }
          sections(func: eq(Section.repo, $repo)) { uid }
          statements(func: eq(Statement.repo, $repo)) { uid }
          acs(func: eq(AcceptanceCriterion.repo, $repo)) { uid }
          codechunks(func: eq(CodeChunk.repo, $repo)) { uid }
          testchunks(func: eq(TestChunk.repo, $repo)) { uid }
          coverages(func: eq(Coverage.repo, $repo)) { uid }
          files(func: eq(File.repo, $repo)) { uid }
        }`,
          { $repo: repo },
        );
        const data = res.data as Record<string, { uid: string }[]>;
        const uids = Object.values(data)
          .flat()
          .map((node) => node.uid);

        if (uids.length) {
          await txn.mutate({
            deleteNquads: uids.map((uid) => `<${uid}> * * .`).join("\n"),
            commitNow: true,
          });
        }
      } catch {
        void 0;
      } finally {
        await txn.discard().catch(() => {});
      }
    }

    async function enrichCodeChunk(
      xid: string,
      fields: Record<string, unknown>,
    ): Promise<void> {
      const txn = dgraphClient.newTxn();

      try {
        const res = await txn.queryWithVars(
          `query cc($xid: string){ cc(func: eq(CodeChunk.xid, $xid), first: 1) { uid } }`,
          { $xid: xid },
        );
        const uid = (res.data as { cc?: { uid: string }[] }).cc?.[0]?.uid;

        if (uid) {
          await txn.mutate({ setJson: { uid, ...fields }, commitNow: true });
        }
      } finally {
        await txn.discard().catch(() => {});
      }
    }

    let createdRepo = "";

    afterEach(async () => {
      if (createdRepo) {
        await deleteRepoNodes(createdRepo);
      }
      createdRepo = "";
    });

    it("projects a Ruby-linked spec to file+line nodes, covers by line overlap, and drifts on a code change", async () => {
      const repo = `lang-e2e/${randomUUID()}`;

      createdRepo = repo;
      const specPath = "specs/widget/spec.md";
      const statementXid = `${repo}|${specPath}|0`;
      const testChunkXid = `${repo}|spec/widget_spec.rb`;
      const codeChunkXid = `${repo}|src/widget.rb|10`;
      const content =
        "## Overview\n\n" +
        "- The widget emits a click. ([validated by](spec/widget_spec.rb#L5), [impl](src/widget.rb#L10))\n";

      await projectSpecFile(repo, specPath, content, dgraphClient);

      const projected = (await readGraph(
        `query q($sx: string){
        stmt(func: eq(Statement.xid, $sx)){
          Statement.validated_by { TestChunk.xid TestChunk.test_name TestChunk.symbol_name }
          Statement.implemented_by { CodeChunk.xid CodeChunk.file_path CodeChunk.symbol_name }
        }
      }`,
        { $sx: statementXid },
      )) as { stmt?: Record<string, unknown>[] };

      expect(projected.stmt?.[0]?.["Statement.validated_by"]).toEqual([
        {
          "TestChunk.xid": testChunkXid,
          "TestChunk.test_name": "validated by",
        },
      ]);
      expect(projected.stmt?.[0]?.["Statement.implemented_by"]).toEqual([
        {
          "CodeChunk.xid": codeChunkXid,
          "CodeChunk.file_path": "src/widget.rb",
        },
      ]);

      await enrichCodeChunk(codeChunkXid, {
        "CodeChunk.end_line": 20,
        "CodeChunk.content_hash": "OLDHASH",
      });

      await ingestCoverageReport(
        dgraphClient,
        { repo, tool: "lcov", commit: "c1" },
        [
          {
            testFile: "spec/widget_spec.rb",
            testName: "validated by",
            covered: [{ file: "src/widget.rb", startLine: 12, endLine: 18 }],
          },
        ],
      );

      const coverage = (await readGraph(
        `query q($xid: string){ cov(func: eq(Coverage.xid, $xid)){ Coverage.covers @facets(ranges) { File.xid } } }`,
        { $xid: `${repo}|spec/widget_spec.rb|validated by` },
      )) as { cov?: { "Coverage.covers"?: Record<string, unknown>[] }[] };

      expect(coverage.cov?.[0]?.["Coverage.covers"]).toEqual([
        {
          "File.xid": `${repo}|src/widget.rb`,
          "Coverage.covers|ranges": "12-18",
        },
      ]);

      await driftCheckFile(
        repo,
        "src/widget.rb",
        [
          {
            filePath: "src/widget.rb",
            startLine: 12,
            endLine: 18,
            contentHash: "NEWHASH",
          },
        ],
        dgraphClient,
      );

      const drifted = (await readGraph(
        `query q($sx: string){ stmt(func: eq(Statement.xid, $sx)){ Statement.drifted Statement.drift_reason } }`,
        { $sx: statementXid },
      )) as { stmt?: Record<string, unknown>[] };

      expect(drifted.stmt?.[0]).toMatchObject({
        "Statement.drifted": true,
        "Statement.drift_reason": "code-content-changed (src/widget.rb)",
      });
    });
  },
);
