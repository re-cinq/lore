import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import * as dgraph from "dgraph-js-http";
import { upsertTraceLink, projectTraceLinks } from "../trace-link.js";

/**
 * upsertTraceLink (spec-traceability-graph, Phase 4 / T242) — reified TraceLink
 * edge-evidence model against the REAL local Dgraph cluster (no mocks).
 * Container-gated: skips when Dgraph isn't reachable.
 *
 * KERNEL facet: one upsert writes one reified TraceLink node carrying kind +
 * evidence + target, linked from the Statement via Statement.trace_links.
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

describe.skipIf(!reachable)("upsertTraceLink (live Dgraph)", () => {
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
          tracelinks(func: eq(TraceLink.repo, $repo)) { uid }
          testchunks(func: eq(TestChunk.repo, $repo)) { uid }
          codechunks(func: eq(CodeChunk.repo, $repo)) { uid }
          coverages(func: eq(Coverage.repo, $repo)) { uid }
          files(func: eq(File.repo, $repo)) { uid }
        }`,
        { $repo: repo },
      );
      const data = res.data as {
        tracelinks?: { uid: string }[];
        testchunks?: { uid: string }[];
        codechunks?: { uid: string }[];
        coverages?: { uid: string }[];
        files?: { uid: string }[];
      };
      const uids = [
        ...(data.tracelinks ?? []),
        ...(data.testchunks ?? []),
        ...(data.codechunks ?? []),
        ...(data.coverages ?? []),
        ...(data.files ?? []),
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

  it("links the Statement to a reified TraceLink carrying kind validated_by, evidence human-linked, and target TestChunk repo|t1", async () => {
    const repo = `tracelink/${randomUUID()}`;
    createdRepo = repo;
    const statementXid = `${repo}|specs/foo/spec.md|7`;
    createdStatementXid = statementXid;

    const tcRes = await dgraphClient.newTxn().mutate({
      setJson: {
        "dgraph.type": "TestChunk",
        "TestChunk.xid": `${repo}|t1`,
        "TestChunk.repo": repo,
        "TestChunk.test_name": "renders",
      },
      commitNow: true,
    });
    const tcUid = Object.values(tcRes.data.uids)[0];

    const stmtRes = await dgraphClient.newTxn().mutate({
      setJson: {
        "dgraph.type": "Statement",
        "Statement.xid": statementXid,
        "Statement.ordinal": 7,
        "Statement.text": "...",
      },
      commitNow: true,
    });
    const stmtUid = Object.values(stmtRes.data.uids)[0];

    await upsertTraceLink(dgraphClient, {
      repo,
      statementUid: stmtUid,
      statementXid,
      targetUid: tcUid,
      targetXid: `${repo}|t1`,
      kind: "validated_by",
      evidence: "human-linked",
    });

    const data = (await readGraph(
      `query q($sx: string) {
        stmt(func: eq(Statement.xid, $sx)) {
          Statement.trace_links {
            TraceLink.kind TraceLink.evidence TraceLink.target { TestChunk.xid }
          }
        }
      }`,
      { $sx: statementXid },
    )) as { stmt?: Record<string, unknown>[] };

    expect(data.stmt?.[0]?.["Statement.trace_links"]).toEqual([
      {
        "TraceLink.kind": "validated_by",
        "TraceLink.evidence": "human-linked",
        "TraceLink.target": { "TestChunk.xid": `${repo}|t1` },
      },
    ]);
  });

  it("reaches the TraceLink from its target via the ~TraceLink.target reverse edge", async () => {
    const repo = `tracelink/${randomUUID()}`;
    createdRepo = repo;
    const statementXid = `${repo}|specs/foo/spec.md|9`;
    createdStatementXid = statementXid;

    const tcRes = await dgraphClient.newTxn().mutate({
      setJson: {
        uid: "_:tc",
        "dgraph.type": "TestChunk",
        "TestChunk.xid": `${repo}|t9`,
        "TestChunk.repo": repo,
      },
      commitNow: true,
    });
    const tcUid = tcRes.data.uids.tc;
    const stmtRes = await dgraphClient.newTxn().mutate({
      setJson: {
        uid: "_:s",
        "dgraph.type": "Statement",
        "Statement.xid": statementXid,
        "Statement.ordinal": 9,
      },
      commitNow: true,
    });
    const stmtUid = stmtRes.data.uids.s;

    await upsertTraceLink(dgraphClient, {
      repo,
      statementUid: stmtUid,
      statementXid,
      targetUid: tcUid,
      targetXid: `${repo}|t9`,
      kind: "validated_by",
      evidence: "human-linked",
    });

    const data = (await readGraph(
      `query q($x: string) {
        target(func: eq(TestChunk.xid, $x)) {
          links: ~TraceLink.target { TraceLink.kind }
        }
      }`,
      { $x: `${repo}|t9` },
    )) as { target?: Array<{ links?: Array<{ "TraceLink.kind"?: string }> }> };
    expect(
      (data.target?.[0]?.links ?? []).map((l) => l["TraceLink.kind"]),
    ).toEqual(["validated_by"]);
  });

  it("derives one human-linked validated_by TraceLink from a Statement.validated_by edge to a TestChunk", async () => {
    const repo = `tracelink/${randomUUID()}`;
    createdRepo = repo;
    const statementXid = `${repo}|specs/foo/spec.md|7`;
    createdStatementXid = statementXid;

    const tcRes = await dgraphClient.newTxn().mutate({
      setJson: {
        uid: "_:tc",
        "dgraph.type": "TestChunk",
        "TestChunk.xid": `${repo}|t1`,
        "TestChunk.repo": repo,
        "TestChunk.test_name": "renders",
      },
      commitNow: true,
    });
    const tcUid = tcRes.data.uids.tc;

    await dgraphClient.newTxn().mutate({
      setJson: {
        uid: "_:stmt",
        "dgraph.type": "Statement",
        "Statement.xid": statementXid,
        "Statement.ordinal": 7,
        "Statement.text": "The widget renders.",
        "Statement.validated_by": [{ uid: tcUid }],
      },
      commitNow: true,
    });

    await projectTraceLinks(dgraphClient, repo, statementXid);

    const data = (await readGraph(
      `query q($sx: string) {
        stmt(func: eq(Statement.xid, $sx)) {
          Statement.trace_links {
            TraceLink.kind TraceLink.evidence TraceLink.target { TestChunk.xid }
          }
        }
      }`,
      { $sx: statementXid },
    )) as { stmt?: Record<string, unknown>[] };

    expect(data.stmt?.[0]?.["Statement.trace_links"]).toEqual([
      {
        "TraceLink.kind": "validated_by",
        "TraceLink.evidence": "human-linked",
        "TraceLink.target": { "TestChunk.xid": `${repo}|t1` },
      },
    ]);
  });

  it("tags the validated_by TraceLink execution-verified when the coverage chain proves it", async () => {
    const repo = `tracelink/${randomUUID()}`;
    createdRepo = repo;
    const statementXid = `${repo}|specs/foo/spec.md|7`;
    createdStatementXid = statementXid;

    const codeChunkRes = await dgraphClient.newTxn().mutate({
      setJson: {
        uid: "_:cc",
        "dgraph.type": "CodeChunk",
        "CodeChunk.xid": `${repo}|src/widget.ts|1`,
        "CodeChunk.repo": repo,
        "CodeChunk.file_path": "src/widget.ts",
        "CodeChunk.start_line": 1,
        "CodeChunk.end_line": 20,
      },
      commitNow: true,
    });
    const ccUid = codeChunkRes.data.uids.cc;

    // Coverage covers the FILE (same path as the implemented CodeChunk) — the
    // execution-verified verdict matches by file path.
    const fileRes = await dgraphClient.newTxn().mutate({
      setJson: {
        uid: "_:f",
        "dgraph.type": "File",
        "File.xid": `${repo}|src/widget.ts`,
        "File.repo": repo,
        "File.path": "src/widget.ts",
      },
      commitNow: true,
    });
    const fileUid = fileRes.data.uids.f;

    const coverageRes = await dgraphClient.newTxn().mutate({
      setJson: {
        uid: "_:cov",
        "dgraph.type": "Coverage",
        "Coverage.xid": `${repo}|t.test.ts|renders`,
        "Coverage.repo": repo,
        "Coverage.covers": [{ uid: fileUid }],
      },
      commitNow: true,
    });
    const covUid = coverageRes.data.uids.cov;

    const testChunkRes = await dgraphClient.newTxn().mutate({
      setJson: {
        uid: "_:tc",
        "dgraph.type": "TestChunk",
        "TestChunk.xid": `${repo}|t1`,
        "TestChunk.repo": repo,
        "TestChunk.test_name": "renders",
        "TestChunk.coverage": { uid: covUid },
      },
      commitNow: true,
    });
    const tcUid = testChunkRes.data.uids.tc;

    await dgraphClient.newTxn().mutate({
      setJson: {
        uid: "_:stmt",
        "dgraph.type": "Statement",
        "Statement.xid": statementXid,
        "Statement.ordinal": 7,
        "Statement.text": "The widget renders.",
        "Statement.validated_by": [{ uid: tcUid }],
        "Statement.implemented_by": [{ uid: ccUid }],
      },
      commitNow: true,
    });

    await projectTraceLinks(dgraphClient, repo, statementXid);

    const data = (await readGraph(
      `query q($sx: string){
        stmt(func: eq(Statement.xid, $sx)){
          Statement.trace_links @filter(eq(TraceLink.kind, "validated_by")) {
            TraceLink.evidence
          }
        }
      }`,
      { $sx: statementXid },
    )) as { stmt?: Record<string, unknown>[] };

    expect(data.stmt?.[0]?.["Statement.trace_links"]).toContainEqual({
      "TraceLink.evidence": "execution-verified",
    });
  });

  it("keeps a generated-provenance TraceLink and does not downgrade it to human-linked on re-derivation", async () => {
    const repo = `tracelink/${randomUUID()}`;
    createdRepo = repo;
    const statementXid = `${repo}|specs/foo/spec.md|7`;
    createdStatementXid = statementXid;

    const tcRes = await dgraphClient.newTxn().mutate({
      setJson: {
        uid: "_:tc",
        "dgraph.type": "TestChunk",
        "TestChunk.xid": `${repo}|t1`,
        "TestChunk.repo": repo,
        "TestChunk.test_name": "renders",
      },
      commitNow: true,
    });
    const tcUid = tcRes.data.uids.tc;

    const stmtRes = await dgraphClient.newTxn().mutate({
      setJson: {
        uid: "_:stmt",
        "dgraph.type": "Statement",
        "Statement.xid": statementXid,
        "Statement.ordinal": 7,
        "Statement.text": "The widget renders.",
        "Statement.validated_by": [{ uid: tcUid }],
      },
      commitNow: true,
    });
    const stmtUid = stmtRes.data.uids.stmt;

    await upsertTraceLink(dgraphClient, {
      repo,
      statementUid: stmtUid,
      statementXid,
      targetUid: tcUid,
      targetXid: `${repo}|t1`,
      kind: "validated_by",
      evidence: "generated-provenance",
    });

    await projectTraceLinks(dgraphClient, repo, statementXid);

    const data = (await readGraph(
      `query q($sx: string){
        stmt(func: eq(Statement.xid, $sx)){
          Statement.trace_links @filter(eq(TraceLink.kind, "validated_by")) {
            TraceLink.evidence
          }
        }
      }`,
      { $sx: statementXid },
    )) as { stmt?: Record<string, unknown>[] };

    expect(data.stmt?.[0]?.["Statement.trace_links"]).toEqual([
      { "TraceLink.evidence": "generated-provenance" },
    ]);
  });
});
