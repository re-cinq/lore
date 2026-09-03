import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { findRepoRoot } from "../lib/repo-root.js";
import { randomUUID } from "node:crypto";
import * as dgraph from "dgraph-js-http";
import { suggestCandidates } from "./suggest-links.js";

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

const unit = (i: number) => {
  const axis = new Array(768).fill(0);

  axis[i] = 1;

  return axis;
};
const lit = (vec: number[]) => "[" + vec.join(",") + "]";

describe.skipIf(!reachable)("suggestCandidates (live Dgraph)", () => {
  const dgraphClient = new dgraph.DgraphClient(
    new dgraph.DgraphClientStub(DGRAPH_HTTP),
  );

  beforeAll(() => {
    execFileSync("bash", [APPLIER], {
      env: { ...process.env, DGRAPH_HTTP },
      stdio: "pipe",
    });
  });

  async function reapNodes(repo: string, statementXid: string): Promise<void> {
    const txn = dgraphClient.newTxn();

    try {
      const res = await txn.queryWithVars(
        `query nodes($repo: string, $sx: string) {
          chunks(func: eq(CodeChunk.repo, $repo)) { uid }
          testChunks(func: eq(TestChunk.repo, $repo)) { uid }
          statements(func: eq(Statement.xid, $sx)) { uid }
        }`,
        { $repo: repo, $sx: statementXid },
      );
      const written = res.data as {
        chunks?: { uid: string }[];
        testChunks?: { uid: string }[];
        statements?: { uid: string }[];
      };
      const uids = [
        ...(written.chunks ?? []),
        ...(written.testChunks ?? []),
        ...(written.statements ?? []),
      ].map((node) => node.uid);

      if (uids.length) {
        await txn.mutate({
          deleteNquads: uids.map((uid) => `<${uid}> * * .`).join("\n"),
          commitNow: true,
        });
      }
      // eslint-disable-next-line no-empty
    } catch {
    } finally {
      await txn.discard().catch(() => {});
    }
  }

  let createdRepo = "";
  let createdStatementXid = "";
  let createdExtraRepos: string[] = [];

  afterEach(async () => {
    if (createdRepo) {
      await reapNodes(createdRepo, createdStatementXid);
    }

    for (const extraRepo of createdExtraRepos) {
      await reapNodes(extraRepo, "");
    }
    createdExtraRepos = [];
  });

  it("returns the same-embedding CodeChunk as the single nearest candidate", async () => {
    const repo = `test-suggest/${randomUUID()}`;

    createdRepo = repo;
    const statementXid = `${repo}|specs/x/spec.md|0`;

    createdStatementXid = statementXid;

    const txn = dgraphClient.newTxn();

    try {
      await txn.mutate({
        setJson: [
          {
            "dgraph.type": "CodeChunk",
            "CodeChunk.xid": `${repo}|ccA`,
            "CodeChunk.repo": repo,
            "CodeChunk.file_path": "src/widget.ts",
            "CodeChunk.embedding": lit(unit(0)),
          },
          {
            "dgraph.type": "Statement",
            "Statement.xid": statementXid,
            "Statement.embedding": lit(unit(0)),
          },
        ],
        commitNow: true,
      });
    } finally {
      await txn.discard().catch(() => {});
    }

    const candidates = await suggestCandidates(dgraphClient, statementXid, 1);

    expect(candidates).toEqual([{ xid: `${repo}|ccA`, kind: "code" }]);
  });

  it("returns the same-embedding TestChunk as a test candidate", async () => {
    const repo = `test-suggest/${randomUUID()}`;

    createdRepo = repo;
    const statementXid = `${repo}|specs/x/spec.md|0`;

    createdStatementXid = statementXid;

    const txn = dgraphClient.newTxn();

    try {
      await txn.mutate({
        setJson: [
          {
            "dgraph.type": "TestChunk",
            "TestChunk.xid": `${repo}|tcA`,
            "TestChunk.repo": repo,
            "TestChunk.file_path": "t.test.ts",
            "TestChunk.embedding": lit(unit(0)),
          },
          {
            "dgraph.type": "Statement",
            "Statement.xid": statementXid,
            "Statement.embedding": lit(unit(0)),
          },
        ],
        commitNow: true,
      });
    } finally {
      await txn.discard().catch(() => {});
    }

    const candidates = await suggestCandidates(dgraphClient, statementXid, 1);

    expect(candidates).toEqual([{ xid: `${repo}|tcA`, kind: "test" }]);
  });

  it("excludes an identical-embedding CodeChunk from a different repo", async () => {
    const repoA = `test-suggest/${randomUUID()}`;
    const repoB = `test-suggest/${randomUUID()}`;
    const statementXid = `${repoA}|specs/x/spec.md|0`;

    createdRepo = repoA;
    createdStatementXid = statementXid;
    createdExtraRepos = [repoB];

    const txn = dgraphClient.newTxn();

    try {
      await txn.mutate({
        setJson: [
          {
            "dgraph.type": "CodeChunk",
            "CodeChunk.xid": `${repoA}|ccA`,
            "CodeChunk.repo": repoA,
            "CodeChunk.file_path": "a.ts",
            "CodeChunk.embedding": lit(unit(0)),
          },
          {
            "dgraph.type": "CodeChunk",
            "CodeChunk.xid": `${repoB}|ccB`,
            "CodeChunk.repo": repoB,
            "CodeChunk.file_path": "b.ts",
            "CodeChunk.embedding": lit(unit(0)),
          },
          {
            "dgraph.type": "Statement",
            "Statement.xid": statementXid,
            "Statement.embedding": lit(unit(0)),
          },
        ],
        commitNow: true,
      });
    } finally {
      await txn.discard().catch(() => {});
    }

    const candidates = await suggestCandidates(dgraphClient, statementXid, 5);

    expect(candidates).toEqual([{ xid: `${repoA}|ccA`, kind: "code" }]);
  });

  it("returns empty when the only matching CodeChunk is already implemented_by the statement", async () => {
    const repo = `test-suggest/${randomUUID()}`;

    createdRepo = repo;
    const statementXid = `${repo}|specs/x/spec.md|0`;

    createdStatementXid = statementXid;

    const linkTxn = dgraphClient.newTxn();
    let linkedUid: string;

    try {
      const res = await linkTxn.mutate({
        setJson: {
          uid: "_:cc",
          "dgraph.type": "CodeChunk",
          "CodeChunk.xid": `${repo}|ccLinked`,
          "CodeChunk.repo": repo,
          "CodeChunk.file_path": "a.ts",
          "CodeChunk.embedding": lit(unit(0)),
        },
        commitNow: true,
      });

      linkedUid = (res.data as { uids: Record<string, string> }).uids.cc;
    } finally {
      await linkTxn.discard().catch(() => {});
    }

    const stmtTxn = dgraphClient.newTxn();

    try {
      await stmtTxn.mutate({
        setJson: {
          "dgraph.type": "Statement",
          "Statement.xid": statementXid,
          "Statement.embedding": lit(unit(0)),
          "Statement.implemented_by": { uid: linkedUid },
        },
        commitNow: true,
      });
    } finally {
      await stmtTxn.discard().catch(() => {});
    }

    const candidates = await suggestCandidates(dgraphClient, statementXid, 5);

    expect(candidates).toEqual([]);
  });

  it("returns the repo-A chunk when 40 identical-embedding repo-B chunks flood the ANN top-k", async () => {
    const repoA = `test-suggest/${randomUUID()}`;
    const repoB = `test-suggest/${randomUUID()}`;
    const statementXid = `${repoA}|specs/x/spec.md|0`;

    createdRepo = repoA;
    createdStatementXid = statementXid;
    createdExtraRepos = [repoB];

    const floodChunks = Array.from({ length: 40 }, (_, i) => ({
      "dgraph.type": "CodeChunk",
      "CodeChunk.xid": `${repoB}|cc${i}`,
      "CodeChunk.repo": repoB,
      "CodeChunk.file_path": `b${i}.ts`,
      "CodeChunk.embedding": lit(unit(5)),
    }));

    const txn = dgraphClient.newTxn();

    try {
      await txn.mutate({
        setJson: [
          ...floodChunks,
          {
            "dgraph.type": "CodeChunk",
            "CodeChunk.xid": `${repoA}|ccA`,
            "CodeChunk.repo": repoA,
            "CodeChunk.file_path": "a.ts",
            "CodeChunk.embedding": lit(unit(5)),
          },
          {
            "dgraph.type": "Statement",
            "Statement.xid": statementXid,
            "Statement.embedding": lit(unit(5)),
          },
        ],
        commitNow: true,
      });
    } finally {
      await txn.discard().catch(() => {});
    }

    const candidates = await suggestCandidates(dgraphClient, statementXid, 5);

    expect(candidates).toEqual([{ xid: `${repoA}|ccA`, kind: "code" }]);
  });
});
