import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { findRepoRoot } from "../lib/repo-root.js";
import { randomUUID } from "node:crypto";
import * as dgraph from "dgraph-js-http";
import { deriveStatementStatus } from "./statement-status.js";
import { upsertTraceLink } from "./trace-link.js";

/**
 * deriveStatementStatus (spec-traceability-graph, Phase 4 / T242) — derives a
 * Statement's STATUS from its TraceLink evidence tiers, against the REAL local
 * Dgraph cluster (no mocks). Container-gated: skips when Dgraph isn't reachable.
 *
 * KERNEL facet: a Statement with NO TraceLinks derives to "untested".
 */

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

describe.skipIf(!reachable)("deriveStatementStatus (live Dgraph)", () => {
  const dgraphClient = new dgraph.DgraphClient(
    new dgraph.DgraphClientStub(DGRAPH_HTTP),
  );

  beforeAll(() => {
    execFileSync("bash", [APPLIER], {
      env: { ...process.env, DGRAPH_HTTP },
      stdio: "pipe",
    });
  });

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

  async function deleteNodesByRepo(
    predicate: string,
    repo: string,
  ): Promise<void> {
    const txn = dgraphClient.newTxn();

    try {
      const res = await txn.queryWithVars(
        `query nodes($repo: string) {
          nodes(func: eq(${predicate}, $repo)) { uid }
        }`,
        { $repo: repo },
      );
      const data = res.data as { nodes?: { uid: string }[] };
      const uids = (data.nodes ?? []).map((node) => node.uid);

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

  let createdStatementXid = "";
  let createdRepo = "";

  afterEach(async () => {
    if (createdRepo) {
      await deleteNodesByRepo("TraceLink.repo", createdRepo);
      await deleteNodesByRepo("TestChunk.repo", createdRepo);
    }

    if (createdStatementXid) {
      await deleteStatementNode(createdStatementXid);
    }
    createdStatementXid = "";
    createdRepo = "";
  });

  it("returns untested for a Statement with no trace links", async () => {
    const repo = `status/${randomUUID()}`;
    const statementXid = `${repo}|specs/foo/spec.md|7`;

    createdStatementXid = statementXid;

    await dgraphClient.newTxn().mutate({
      setJson: {
        "dgraph.type": "Statement",
        "Statement.xid": statementXid,
        "Statement.ordinal": 7,
        "Statement.text": "The widget renders.",
      },
      commitNow: true,
    });

    const status = await deriveStatementStatus(dgraphClient, statementXid);

    expect(status).toBe("untested");
  });

  it("returns claimed for a statement whose only trace link is human-linked", async () => {
    const repo = `status/${randomUUID()}`;
    const statementXid = `${repo}|specs/foo/spec.md|7`;

    createdRepo = repo;
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
      evidence: "human-linked",
    });

    const status = await deriveStatementStatus(dgraphClient, statementXid);

    expect(status).toBe("claimed");
  });

  it("returns verified-implemented for a statement with an execution-verified trace link", async () => {
    const repo = `status/${randomUUID()}`;
    const statementXid = `${repo}|specs/foo/spec.md|7`;

    createdRepo = repo;
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
      evidence: "execution-verified",
    });

    const status = await deriveStatementStatus(dgraphClient, statementXid);

    expect(status).toBe("verified-implemented");
  });
});
