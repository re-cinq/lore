import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { findRepoRoot } from "../../lib/repo-root.js";
import { randomUUID } from "node:crypto";
import * as dgraph from "dgraph-js-http";
import { driftCheckFile } from "./drift-check-file.js";
import type { DriftedStatement } from "./format-drift-report.js";
import { makeDeleteRepoNodes } from "../../outbound/spec-trace/test-helpers/delete-repo-nodes.js";
import { dgraphReachable } from "../../lib/dgraph-test-gate.js";

const DGRAPH_HTTP = process.env.DGRAPH_HTTP ?? "http://localhost:8081";
const APPLIER = join(
  findRepoRoot(),
  "scripts",
  "infra",
  "setup-spec-trace-schema.sh",
);

const pad768 = (head: number[]): number[] =>
  Object.assign(new Array(768).fill(0), head);

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

  const deleteRepoNodes = makeDeleteRepoNodes(dgraphClient, [
    { alias: "testchunks", type: "TestChunk" },
    { alias: "codechunks", type: "CodeChunk" },
    { alias: "coverages", type: "Coverage" },
    { alias: "testsuites", type: "TestSuite" },
  ]);

  async function deleteStatementNode(statementXid: string): Promise<void> {
    const txn = dgraphClient.newTxn();

    try {
      const res = await txn.queryWithVars(
        `query stmt($sx: string) {
          stmts(func: eq(Statement.xid, $sx)) { uid }
        }`,
        { $sx: statementXid },
      );
      const written = res.data as { stmts?: { uid: string }[] };
      const uids = (written.stmts ?? []).map((node) => node.uid);

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

  async function deleteAcceptanceCriterionNode(acXid: string): Promise<void> {
    const txn = dgraphClient.newTxn();

    try {
      const res = await txn.queryWithVars(
        `query ac($ax: string) {
          acs(func: eq(AcceptanceCriterion.xid, $ax)) { uid }
        }`,
        { $ax: acXid },
      );
      const written = res.data as { acs?: { uid: string }[] };
      const uids = (written.acs ?? []).map((node) => node.uid);

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

  interface ChunkSeed {
    filePath?: string;
    startLine?: number;
    endLine?: number;
    symbolName?: string | null;
    contentHash?: string | null;
  }

  const ORDINARY_CHUNK = {
    filePath: "src/widget.ts",
    startLine: 1,
    endLine: 20,
    symbolName: "render" as string | null,
    contentHash: "OLDHASH" as string | null,
  };

  async function seedCodeChunk(
    repo: string,
    seed: ChunkSeed = {},
  ): Promise<string> {
    const { filePath, startLine, endLine, symbolName, contentHash } = {
      ...ORDINARY_CHUNK,
      ...seed,
    };
    const seeded = await dgraphClient.newTxn().mutate({
      setJson: {
        uid: "_:cc",
        "dgraph.type": "CodeChunk",
        "CodeChunk.xid": `${repo}|${filePath}|${startLine}`,
        "CodeChunk.repo": repo,
        "CodeChunk.file_path": filePath,
        "CodeChunk.start_line": startLine,
        "CodeChunk.end_line": endLine,
        ...(symbolName === null ? {} : { "CodeChunk.symbol_name": symbolName }),
        ...(contentHash === null
          ? {}
          : { "CodeChunk.content_hash": contentHash }),
      },
      commitNow: true,
    });

    return seeded.data.uids.cc;
  }

  interface SpecNodeSeed {
    type?: "Statement" | "AcceptanceCriterion";
    xid: string;
    ordinal?: number;
    text?: string;
    codeChunkUid: string;
    embedding?: string;
  }

  const ORDINARY_SPEC_NODE = {
    type: "Statement" as "Statement" | "AcceptanceCriterion",
    ordinal: 7,
    text: "The widget renders a click.",
    embedding: undefined as string | undefined,
  };

  async function seedSpecNode(seed: SpecNodeSeed): Promise<void> {
    const { type, xid, ordinal, text, codeChunkUid, embedding } = {
      ...ORDINARY_SPEC_NODE,
      ...seed,
    };

    await dgraphClient.newTxn().mutate({
      setJson: {
        "dgraph.type": type,
        [`${type}.xid`]: xid,
        [`${type}.ordinal`]: ordinal,
        [`${type}.text`]: text,
        [`${type}.implemented_by`]: [{ uid: codeChunkUid }],
        ...(embedding === undefined
          ? {}
          : { [`${type}.embedding`]: embedding }),
      },
      commitNow: true,
    });
  }

  let createdRepo = "";
  let createdStatementXid = "";
  let createdAcXid = "";

  afterEach(async () => {
    if (createdRepo) {
      await deleteRepoNodes(createdRepo);
    }

    if (createdStatementXid) {
      await deleteStatementNode(createdStatementXid);
    }

    if (createdAcXid) {
      await deleteAcceptanceCriterionNode(createdAcXid);
    }
    createdStatementXid = "";
    createdAcXid = "";
  });

  it("flips the Statement drifted with reason code-content-changed (render) and updates the CodeChunk hash to NEWHASH when the implementing chunk's content_hash changed", async () => {
    const repo = `drift/${randomUUID()}`;

    createdRepo = repo;
    const statementXid = `${repo}|specs/foo/spec.md|7`;

    createdStatementXid = statementXid;

    const codeChunkUid = await seedCodeChunk(repo);

    await seedSpecNode({ xid: statementXid, codeChunkUid });

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

    const codeChunkUid = await seedCodeChunk(repo);

    await seedSpecNode({ xid: statementXid, codeChunkUid });

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

    const codeChunkUid = await seedCodeChunk(repo);

    await seedSpecNode({
      type: "AcceptanceCriterion",
      xid: acXid,
      ordinal: 3,
      text: "The system rejects an expired token.",
      codeChunkUid: codeChunkUid,
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

    const codeChunkUid = await seedCodeChunk(repo, { contentHash: null });

    await seedSpecNode({ xid: statementXid, codeChunkUid });

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

    const codeChunkUid = await seedCodeChunk(repo, { filePath: "src/gone.ts" });

    await seedSpecNode({ xid: statementXid, codeChunkUid });

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

    const codeChunkUid = await seedCodeChunk(repo);

    await seedSpecNode({
      xid: statementXid,
      codeChunkUid: codeChunkUid,
      embedding: `[${pad768([1, 1, 0]).join(",")}]`,
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

    const codeChunkUid = await seedCodeChunk(repo, {
      startLine: 50,
      endLine: 60,
    });

    await seedSpecNode({ xid: statementXid, codeChunkUid });

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

    const ccUid = await seedCodeChunk(repo, {
      filePath: "src/widget.rb",
      startLine: 10,
      symbolName: null,
    });

    await seedSpecNode({
      xid: statementXid,
      text: "The widget emits a click.",
      codeChunkUid: ccUid,
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
