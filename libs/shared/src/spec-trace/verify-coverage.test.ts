import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import * as dgraph from "dgraph-js-http";
import { verifyCoverageLink } from "./verify-coverage.js";

/**
 * verifyCoverageLink (spec-traceability-graph, Phase 3 coverage-first
 * verification) — derives a verdict for ONE statement by walking the live
 * graph. Tested against real Dgraph (no mocks). Container-gated.
 *
 * Three verdicts: "execution-verified" when a VALIDATED_BY test covers a
 * CodeChunk the statement IMPLEMENTS (covered ∩ implemented ≠ ∅);
 * "link-unproven" when validating tests exist but cover nothing the statement
 * implements; "untested" when the statement has no VALIDATED_BY test at all.
 */

const DGRAPH_HTTP = process.env.DGRAPH_HTTP ?? "http://localhost:8081";
const REPO_ROOT = join(process.cwd(), "..");
const APPLIER = join(
  REPO_ROOT,
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

describe.skipIf(!reachable)("verifyCoverageLink (live Dgraph)", () => {
  const dgraphClient = new dgraph.DgraphClient(
    new dgraph.DgraphClientStub(DGRAPH_HTTP),
  );

  beforeAll(() => {
    execFileSync("bash", [APPLIER], {
      env: { ...process.env, DGRAPH_HTTP },
      stdio: "pipe",
    });
  });

  async function mutate(
    setJson: Record<string, unknown>,
  ): Promise<Record<string, string>> {
    const txn = dgraphClient.newTxn();
    try {
      const res = (await txn.mutate({ setJson, commitNow: true })) as {
        data?: { uids?: Record<string, string> };
      };
      return res.data?.uids ?? {};
    } finally {
      await txn.discard().catch(() => {});
    }
  }

  async function deleteRepoNodes(
    repo: string,
    statementXid: string,
  ): Promise<void> {
    const txn = dgraphClient.newTxn();
    try {
      const res = await txn.queryWithVars(
        `query nodes($repo: string, $sx: string) {
          coverage(func: eq(Coverage.repo, $repo)) { uid }
          codechunks(func: eq(CodeChunk.repo, $repo)) { uid }
          testchunks(func: eq(TestChunk.repo, $repo)) { uid }
          statements(func: eq(Statement.xid, $sx)) { uid }
        }`,
        { $repo: repo, $sx: statementXid },
      );
      const data = res.data as {
        coverage?: { uid: string }[];
        codechunks?: { uid: string }[];
        testchunks?: { uid: string }[];
        statements?: { uid: string }[];
      };
      const uids = [
        ...(data.coverage ?? []),
        ...(data.codechunks ?? []),
        ...(data.testchunks ?? []),
        ...(data.statements ?? []),
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

  let createdRepo = "";
  let createdStatementXid = "";
  afterEach(async () => {
    if (createdRepo) await deleteRepoNodes(createdRepo, createdStatementXid);
  });

  it("returns execution-verified when the validating test covers code the statement implements", async () => {
    const repo = `test-verify/${randomUUID()}`;
    createdRepo = repo;
    const statementXid = `${repo}|specs/x/spec.md|0`;
    createdStatementXid = statementXid;

    const ccUids = await mutate({
      uid: "_:cc",
      "dgraph.type": "CodeChunk",
      "CodeChunk.xid": `${repo}|ccX`,
      "CodeChunk.repo": repo,
      "CodeChunk.file_path": "src/widget.ts",
      "CodeChunk.start_line": 1,
      "CodeChunk.end_line": 20,
    });
    const ccXuid = ccUids.cc;

    const tcUids = await mutate({
      uid: "_:tc",
      "dgraph.type": "TestChunk",
      "TestChunk.xid": `${repo}|tc1`,
      "TestChunk.repo": repo,
      "TestChunk.file_path": "t.test.ts",
      "TestChunk.test_name": "renders",
    });
    const tc1uid = tcUids.tc;

    // Coverage covers a FILE (same path as the implemented CodeChunk) — the match
    // is by file path, not node identity.
    const fileUids = await mutate({
      uid: "_:f",
      "dgraph.type": "File",
      "File.xid": `${repo}|src/widget.ts`,
      "File.repo": repo,
      "File.path": "src/widget.ts",
    });
    const covUids = await mutate({
      uid: "_:cov",
      "dgraph.type": "Coverage",
      "Coverage.xid": `${repo}|t.test.ts|renders`,
      "Coverage.repo": repo,
      "Coverage.covers": [{ uid: fileUids.f }],
    });
    const cov1uid = covUids.cov;

    await mutate({ uid: tc1uid, "TestChunk.coverage": { uid: cov1uid } });

    await mutate({
      uid: "_:stmt",
      "dgraph.type": "Statement",
      "Statement.xid": statementXid,
      "Statement.validated_by": [{ uid: tc1uid }],
      "Statement.implemented_by": [{ uid: ccXuid }],
    });

    const verdict = await verifyCoverageLink(dgraphClient, statementXid);

    expect(verdict).toBe("execution-verified");
  });

  it("returns untested when the statement has no validated_by test", async () => {
    const repo = `test-verify/${randomUUID()}`;
    createdRepo = repo;
    const statementXid = `${repo}|specs/x/spec.md|0`;
    createdStatementXid = statementXid;

    const ccUids = await mutate({
      uid: "_:cc",
      "dgraph.type": "CodeChunk",
      "CodeChunk.xid": `${repo}|ccX`,
      "CodeChunk.repo": repo,
      "CodeChunk.file_path": "src/widget.ts",
      "CodeChunk.start_line": 1,
      "CodeChunk.end_line": 20,
    });
    const ccXuid = ccUids.cc;

    await mutate({
      "dgraph.type": "Statement",
      "Statement.xid": statementXid,
      "Statement.implemented_by": [{ uid: ccXuid }],
    });

    const verdict = await verifyCoverageLink(dgraphClient, statementXid);

    expect(verdict).toBe("untested");
  });

  it("returns link-unproven when a validating test exists but covers nothing the statement implements", async () => {
    const repo = `test-verify/${randomUUID()}`;
    createdRepo = repo;
    const statementXid = `${repo}|specs/x/spec.md|0`;
    createdStatementXid = statementXid;

    const ccUids = await mutate({
      uid: "_:cc",
      "dgraph.type": "CodeChunk",
      "CodeChunk.xid": `${repo}|ccX`,
      "CodeChunk.repo": repo,
      "CodeChunk.file_path": "src/widget.ts",
      "CodeChunk.start_line": 1,
      "CodeChunk.end_line": 20,
    });
    const ccXuid = ccUids.cc;

    // A validating test with no Coverage at all → covered set is empty, so it
    // overlaps none of the statement's implemented code.
    const tcUids = await mutate({
      uid: "_:tc",
      "dgraph.type": "TestChunk",
      "TestChunk.xid": `${repo}|tc1`,
      "TestChunk.repo": repo,
      "TestChunk.file_path": "t.test.ts",
      "TestChunk.test_name": "renders",
    });

    await mutate({
      "dgraph.type": "Statement",
      "Statement.xid": statementXid,
      "Statement.validated_by": [{ uid: tcUids.tc }],
      "Statement.implemented_by": [{ uid: ccXuid }],
    });

    const verdict = await verifyCoverageLink(dgraphClient, statementXid);

    expect(verdict).toBe("link-unproven");
  });
});
