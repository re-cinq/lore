import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import * as dgraph from "dgraph-js-http";
import { driftCheckFile } from "./drift-check-file.js";
import type { DriftedStatement } from "./format-drift-report.js";

/**
 * driftCheckFile (spec-traceability-graph, Phase 4 / T240) — when an
 * implementation chunk's content changed (content_hash differs) while its test
 * is unchanged, the connected Statement flips drifted=true with a code-content
 * drift_reason. Runs against the REAL local Dgraph cluster (no mocks).
 * Container-gated: skips when Dgraph isn't reachable.
 *
 * KERNEL facet: a Statement linked Statement.implemented_by -> CodeChunk whose
 * stored content_hash differs from the new chunk's hash flips drifted=true with
 * drift_reason "code-content-changed (render)", and the CodeChunk's stored hash
 * is updated to the new value.
 */

const DGRAPH_HTTP = process.env.DGRAPH_HTTP ?? "http://localhost:8081";
const REPO_ROOT = join(process.cwd(), "..");
const APPLIER = join(
  REPO_ROOT,
  "scripts",
  "infra",
  "setup-spec-trace-schema.sh",
);

// Embedding predicates carry a single global HNSW index per predicate across the
// shared Dgraph container, so every test must use the same dimension (768 — the
// real Vertex text-embedding-005 size) or inserts collide with sibling suites
// ("can not compute dot product on vectors of different lengths"). Zero-padding
// leaves dot products and norms — hence cosine severity — unchanged.
const pad768 = (head: number[]): number[] =>
  Object.assign(new Array(768).fill(0), head);

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

describe.skipIf(!reachable)("driftCheckFile (live Dgraph)", () => {
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

  async function deleteAcceptanceCriterionNode(acXid: string): Promise<void> {
    const txn = dgraphClient.newTxn();
    try {
      const res = await txn.queryWithVars(
        `query ac($ax: string) {
          acs(func: eq(AcceptanceCriterion.xid, $ax)) { uid }
        }`,
        { $ax: acXid },
      );
      const data = res.data as { acs?: { uid: string }[] };
      const uids = (data.acs ?? []).map((node) => node.uid);
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
  let createdAcXid = "";
  afterEach(async () => {
    if (createdRepo) await deleteRepoNodes(createdRepo);
    if (createdStatementXid) await deleteStatementNode(createdStatementXid);
    if (createdAcXid) await deleteAcceptanceCriterionNode(createdAcXid);
    createdStatementXid = "";
    createdAcXid = "";
  });

  it("flips the Statement drifted with reason code-content-changed (render) and updates the CodeChunk hash to NEWHASH when the implementing chunk's content_hash changed", async () => {
    const repo = `drift/${randomUUID()}`;
    createdRepo = repo;
    const statementXid = `${repo}|specs/foo/spec.md|7`;
    createdStatementXid = statementXid;

    const seededCodeChunk = await dgraphClient.newTxn().mutate({
      setJson: {
        uid: "_:cc",
        "dgraph.type": "CodeChunk",
        "CodeChunk.xid": `${repo}|src/widget.ts|1`,
        "CodeChunk.repo": repo,
        "CodeChunk.file_path": "src/widget.ts",
        "CodeChunk.start_line": 1,
        "CodeChunk.end_line": 20,
        "CodeChunk.symbol_name": "render",
        "CodeChunk.content_hash": "OLDHASH",
      },
      commitNow: true,
    });
    const codeChunkUid = seededCodeChunk.data.uids.cc;

    await dgraphClient.newTxn().mutate({
      setJson: {
        "dgraph.type": "Statement",
        "Statement.xid": statementXid,
        "Statement.ordinal": 7,
        "Statement.text": "The widget renders a click.",
        "Statement.implemented_by": [{ uid: codeChunkUid }],
      },
      commitNow: true,
    });

    await driftCheckFile(
      repo,
      "src/widget.ts",
      [
        {
          filePath: "src/widget.ts",
          startLine: 5,
          endLine: 10,
          contentHash: "NEWHASH",
          symbolName: "render",
        },
      ],
      dgraphClient,
    );

    const statementData = (await readGraph(
      `query q($sx: string) {
        stmt(func: eq(Statement.xid, $sx)) {
          Statement.drifted Statement.drift_reason
        }
      }`,
      { $sx: statementXid },
    )) as { stmt?: Record<string, unknown>[] };

    expect(statementData.stmt?.[0]).toMatchObject({
      "Statement.drifted": true,
      "Statement.drift_reason": "code-content-changed (render)",
    });

    const codeChunkData = (await readGraph(
      `query q($xid: string) {
        cc(func: eq(CodeChunk.xid, $xid)) {
          CodeChunk.content_hash
        }
      }`,
      { $xid: `${repo}|src/widget.ts|1` },
    )) as { cc?: Record<string, unknown>[] };

    expect(codeChunkData.cc?.[0]?.["CodeChunk.content_hash"]).toBe("NEWHASH");
  });

  it("returns the drifted statement as a DriftedStatement with specPath ordinal text and reason", async () => {
    const repo = `drift/${randomUUID()}`;
    createdRepo = repo;
    const statementXid = `${repo}|specs/foo/spec.md|7`;
    createdStatementXid = statementXid;

    const seededCodeChunk = await dgraphClient.newTxn().mutate({
      setJson: {
        uid: "_:cc",
        "dgraph.type": "CodeChunk",
        "CodeChunk.xid": `${repo}|src/widget.ts|1`,
        "CodeChunk.repo": repo,
        "CodeChunk.file_path": "src/widget.ts",
        "CodeChunk.start_line": 1,
        "CodeChunk.end_line": 20,
        "CodeChunk.symbol_name": "render",
        "CodeChunk.content_hash": "OLDHASH",
      },
      commitNow: true,
    });
    const codeChunkUid = seededCodeChunk.data.uids.cc;

    await dgraphClient.newTxn().mutate({
      setJson: {
        "dgraph.type": "Statement",
        "Statement.xid": statementXid,
        "Statement.ordinal": 7,
        "Statement.text": "The widget renders a click.",
        "Statement.implemented_by": [{ uid: codeChunkUid }],
      },
      commitNow: true,
    });

    const result = await driftCheckFile(
      repo,
      "src/widget.ts",
      [
        {
          filePath: "src/widget.ts",
          startLine: 5,
          endLine: 10,
          contentHash: "NEWHASH",
          symbolName: "render",
        },
      ],
      dgraphClient,
    );

    const expected: DriftedStatement[] = [
      {
        specPath: "specs/foo/spec.md",
        ordinal: 7,
        statementText: "The widget renders a click.",
        reason: "code-content-changed (render)",
      },
    ];
    expect(result.drifted).toEqual(expected);
  });

  it("drifts an AcceptanceCriterion implemented by a changed chunk", async () => {
    const repo = `drift/${randomUUID()}`;
    createdRepo = repo;
    const acXid = `${repo}|specs/foo/spec.md|ac|3`;
    createdAcXid = acXid;

    const seededCodeChunk = await dgraphClient.newTxn().mutate({
      setJson: {
        uid: "_:cc",
        "dgraph.type": "CodeChunk",
        "CodeChunk.xid": `${repo}|src/widget.ts|1`,
        "CodeChunk.repo": repo,
        "CodeChunk.file_path": "src/widget.ts",
        "CodeChunk.start_line": 1,
        "CodeChunk.end_line": 20,
        "CodeChunk.symbol_name": "render",
        "CodeChunk.content_hash": "OLDHASH",
      },
      commitNow: true,
    });
    const codeChunkUid = seededCodeChunk.data.uids.cc;

    await dgraphClient.newTxn().mutate({
      setJson: {
        "dgraph.type": "AcceptanceCriterion",
        "AcceptanceCriterion.xid": acXid,
        "AcceptanceCriterion.ordinal": 3,
        "AcceptanceCriterion.text": "The system rejects an expired token.",
        "AcceptanceCriterion.implemented_by": [{ uid: codeChunkUid }],
      },
      commitNow: true,
    });

    const result = await driftCheckFile(
      repo,
      "src/widget.ts",
      [
        {
          filePath: "src/widget.ts",
          startLine: 5,
          endLine: 10,
          contentHash: "NEWHASH",
          symbolName: "render",
        },
      ],
      dgraphClient,
    );

    const acData = (await readGraph(
      `query q($ax: string) {
        ac(func: eq(AcceptanceCriterion.xid, $ax)) {
          AcceptanceCriterion.drifted AcceptanceCriterion.drift_reason
        }
      }`,
      { $ax: acXid },
    )) as { ac?: Record<string, unknown>[] };

    expect(acData.ac?.[0]).toMatchObject({
      "AcceptanceCriterion.drifted": true,
      "AcceptanceCriterion.drift_reason": "code-content-changed (render)",
    });

    expect(result.drifted).toContainEqual({
      specPath: "specs/foo/spec.md",
      ordinal: 3,
      statementText: "The system rejects an expired token.",
      reason: "code-content-changed (render)",
    });
  });

  it("baselines a first-sight chunk with no stored hash instead of drifting it", async () => {
    const repo = `drift/${randomUUID()}`;
    createdRepo = repo;
    const statementXid = `${repo}|specs/foo/spec.md|7`;
    createdStatementXid = statementXid;

    const seededCodeChunk = await dgraphClient.newTxn().mutate({
      setJson: {
        uid: "_:cc",
        "dgraph.type": "CodeChunk",
        "CodeChunk.xid": `${repo}|src/widget.ts|1`,
        "CodeChunk.repo": repo,
        "CodeChunk.file_path": "src/widget.ts",
        "CodeChunk.start_line": 1,
        "CodeChunk.end_line": 20,
        "CodeChunk.symbol_name": "render",
      },
      commitNow: true,
    });
    const codeChunkUid = seededCodeChunk.data.uids.cc;

    await dgraphClient.newTxn().mutate({
      setJson: {
        "dgraph.type": "Statement",
        "Statement.xid": statementXid,
        "Statement.ordinal": 7,
        "Statement.text": "The widget renders a click.",
        "Statement.implemented_by": [{ uid: codeChunkUid }],
      },
      commitNow: true,
    });

    const result = await driftCheckFile(
      repo,
      "src/widget.ts",
      [
        {
          filePath: "src/widget.ts",
          startLine: 5,
          endLine: 10,
          contentHash: "FIRSTHASH",
          symbolName: "render",
        },
      ],
      dgraphClient,
    );

    expect(result.baselined).toBe(1);

    const statementData = (await readGraph(
      `query q($sx: string) {
        stmt(func: eq(Statement.xid, $sx)) {
          Statement.drifted
        }
      }`,
      { $sx: statementXid },
    )) as { stmt?: Record<string, unknown>[] };

    expect(statementData.stmt?.[0]?.["Statement.drifted"]).toBeUndefined();

    const codeChunkData = (await readGraph(
      `query q($xid: string) {
        cc(func: eq(CodeChunk.xid, $xid)) {
          CodeChunk.content_hash
        }
      }`,
      { $xid: `${repo}|src/widget.ts|1` },
    )) as { cc?: Record<string, unknown>[] };

    expect(codeChunkData.cc?.[0]?.["CodeChunk.content_hash"]).toBe("FIRSTHASH");
  });

  it("drifts a statement with reason file-missing when the implementing file has no chunks", async () => {
    const repo = `drift/${randomUUID()}`;
    createdRepo = repo;
    const statementXid = `${repo}|specs/foo/spec.md|7`;
    createdStatementXid = statementXid;

    const seededCodeChunk = await dgraphClient.newTxn().mutate({
      setJson: {
        uid: "_:cc",
        "dgraph.type": "CodeChunk",
        "CodeChunk.xid": `${repo}|src/gone.ts|1`,
        "CodeChunk.repo": repo,
        "CodeChunk.file_path": "src/gone.ts",
        "CodeChunk.start_line": 1,
        "CodeChunk.end_line": 20,
        "CodeChunk.symbol_name": "render",
        "CodeChunk.content_hash": "OLDHASH",
      },
      commitNow: true,
    });
    const codeChunkUid = seededCodeChunk.data.uids.cc;

    await dgraphClient.newTxn().mutate({
      setJson: {
        "dgraph.type": "Statement",
        "Statement.xid": statementXid,
        "Statement.ordinal": 7,
        "Statement.text": "The widget renders a click.",
        "Statement.implemented_by": [{ uid: codeChunkUid }],
      },
      commitNow: true,
    });

    await driftCheckFile(repo, "src/gone.ts", [], dgraphClient);

    const statementData = (await readGraph(
      `query q($sx: string) {
        stmt(func: eq(Statement.xid, $sx)) {
          Statement.drifted Statement.drift_reason
        }
      }`,
      { $sx: statementXid },
    )) as { stmt?: Record<string, unknown>[] };

    expect(statementData.stmt?.[0]?.["Statement.drifted"]).toBe(true);
    expect(statementData.stmt?.[0]?.["Statement.drift_reason"]).toBe(
      "file-missing",
    );
  });

  it("sets drift_severity to the cosine distance between the new chunk and statement embeddings", async () => {
    const repo = `drift/${randomUUID()}`;
    createdRepo = repo;
    const statementXid = `${repo}|specs/foo/spec.md|7`;
    createdStatementXid = statementXid;

    const seededCodeChunk = await dgraphClient.newTxn().mutate({
      setJson: {
        uid: "_:cc",
        "dgraph.type": "CodeChunk",
        "CodeChunk.xid": `${repo}|src/widget.ts|1`,
        "CodeChunk.repo": repo,
        "CodeChunk.file_path": "src/widget.ts",
        "CodeChunk.start_line": 1,
        "CodeChunk.end_line": 20,
        "CodeChunk.symbol_name": "render",
        "CodeChunk.content_hash": "OLDHASH",
      },
      commitNow: true,
    });
    const codeChunkUid = seededCodeChunk.data.uids.cc;

    await dgraphClient.newTxn().mutate({
      setJson: {
        "dgraph.type": "Statement",
        "Statement.xid": statementXid,
        "Statement.ordinal": 7,
        "Statement.text": "The widget renders a click.",
        "Statement.implemented_by": [{ uid: codeChunkUid }],
        "Statement.embedding": `[${pad768([1, 1, 0]).join(",")}]`,
      },
      commitNow: true,
    });

    await driftCheckFile(
      repo,
      "src/widget.ts",
      [
        {
          filePath: "src/widget.ts",
          startLine: 5,
          endLine: 10,
          contentHash: "NEWHASH",
          symbolName: "render",
          embedding: pad768([1, 0, 0]),
        },
      ],
      dgraphClient,
    );

    const statementData = (await readGraph(
      `query q($sx: string) {
        stmt(func: eq(Statement.xid, $sx)) {
          Statement.drifted Statement.drift_severity
        }
      }`,
      { $sx: statementXid },
    )) as { stmt?: Record<string, unknown>[] };

    const stmt = statementData.stmt?.[0] ?? {};
    expect(stmt["Statement.drifted"]).toBe(true);
    expect(Number(stmt["Statement.drift_severity"])).toBeCloseTo(0.2929, 3);
  });

  it("drifts a statement with reason line-out-of-range when the chunk lines overlap no remaining chunk", async () => {
    const repo = `drift/${randomUUID()}`;
    createdRepo = repo;
    const statementXid = `${repo}|specs/foo/spec.md|7`;
    createdStatementXid = statementXid;

    const seededCodeChunk = await dgraphClient.newTxn().mutate({
      setJson: {
        uid: "_:cc",
        "dgraph.type": "CodeChunk",
        "CodeChunk.xid": `${repo}|src/widget.ts|50`,
        "CodeChunk.repo": repo,
        "CodeChunk.file_path": "src/widget.ts",
        "CodeChunk.start_line": 50,
        "CodeChunk.end_line": 60,
        "CodeChunk.symbol_name": "render",
        "CodeChunk.content_hash": "OLDHASH",
      },
      commitNow: true,
    });
    const codeChunkUid = seededCodeChunk.data.uids.cc;

    await dgraphClient.newTxn().mutate({
      setJson: {
        "dgraph.type": "Statement",
        "Statement.xid": statementXid,
        "Statement.ordinal": 7,
        "Statement.text": "The widget renders a click.",
        "Statement.implemented_by": [{ uid: codeChunkUid }],
      },
      commitNow: true,
    });

    await driftCheckFile(
      repo,
      "src/widget.ts",
      [
        {
          filePath: "src/widget.ts",
          startLine: 1,
          endLine: 10,
          contentHash: "NEWHASH",
          symbolName: "other",
        },
      ],
      dgraphClient,
    );

    const statementData = (await readGraph(
      `query q($sx: string) {
        stmt(func: eq(Statement.xid, $sx)) {
          Statement.drifted Statement.drift_reason
        }
      }`,
      { $sx: statementXid },
    )) as { stmt?: Record<string, unknown>[] };

    expect(statementData.stmt?.[0]?.["Statement.drifted"]).toBe(true);
    expect(statementData.stmt?.[0]?.["Statement.drift_reason"]).toBe(
      "line-out-of-range",
    );
  });

  it("falls back to the file path in drift_reason when the changed chunk has no symbol_name", async () => {
    const repo = `drift/${randomUUID()}`;
    createdRepo = repo;
    const statementXid = `${repo}|specs/foo/spec.md|7`;
    createdStatementXid = statementXid;

    const seededCodeChunk = await dgraphClient.newTxn().mutate({
      setJson: {
        uid: "_:cc",
        "dgraph.type": "CodeChunk",
        "CodeChunk.xid": `${repo}|src/widget.rb|10`,
        "CodeChunk.repo": repo,
        "CodeChunk.file_path": "src/widget.rb",
        "CodeChunk.start_line": 10,
        "CodeChunk.end_line": 20,
        "CodeChunk.content_hash": "OLDHASH",
      },
      commitNow: true,
    });
    const ccUid = seededCodeChunk.data.uids.cc;

    await dgraphClient.newTxn().mutate({
      setJson: {
        uid: "_:stmt",
        "dgraph.type": "Statement",
        "Statement.xid": statementXid,
        "Statement.ordinal": 7,
        "Statement.text": "The widget emits a click.",
        "Statement.implemented_by": [{ uid: ccUid }],
      },
      commitNow: true,
    });

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

    const statementData = (await readGraph(
      `query q($sx: string) {
        stmt(func: eq(Statement.xid, $sx)) {
          Statement.drifted Statement.drift_reason
        }
      }`,
      { $sx: statementXid },
    )) as { stmt?: Record<string, unknown>[] };

    const stmt = statementData.stmt?.[0] ?? {};
    expect(stmt["Statement.drifted"]).toBe(true);
    expect(stmt["Statement.drift_reason"]).toBe(
      "code-content-changed (src/widget.rb)",
    );
  });
});
