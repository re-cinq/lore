import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import * as dgraph from "dgraph-js-http";
import { findRepoRoot } from "../../lib/repo-root.js";
import { dgraphReachable } from "../../lib/dgraph-test-gate.js";
import { ingestSpecTrace } from "./ingest-spec-trace.js";
import { readGraphBaseline } from "./graph-baseline.js";
import { readOverlay, dropOverlay } from "./overlay.js";
import { upsertByXid } from "../../outbound/spec-trace/dgraph-upsert.js";

const DGRAPH_HTTP = process.env.DGRAPH_HTTP ?? "http://localhost:8081";
const APPLIER = join(
  findRepoRoot(),
  "scripts",
  "infra",
  "setup-spec-trace-schema.sh",
);

const reachable = await dgraphReachable();

function report(runId?: string) {
  return {
    commit: "branchsha",
    branch: "lore/impl/issue-9",
    ...(runId ? { assemblyRunId: runId } : {}),
    tests: [
      {
        id: "src/widget.test.ts::adds",
        name: "adds",
        file: "src/widget.test.ts",
        startLine: 4,
        endLine: 9,
        spec: "specs/widget/spec.md#1",
      },
    ],
    results: [
      {
        id: "src/widget.test.ts::adds",
        passed: true,
        covered: [{ file: "src/widget.ts", startLine: 1, endLine: 20 }],
      },
    ],
  };
}

describe.skipIf(!reachable)("overlay-mode ingest (live Dgraph)", () => {
  const client = new dgraph.DgraphClient(
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
    const txn = client.newTxn();

    try {
      return ((await txn.queryWithVars(query, vars)).data ?? {}) as Record<
        string,
        unknown
      >;
    } finally {
      await txn.discard().catch(() => {});
    }
  }

  const testChunksOf = async (scopeKey: string) =>
    (
      (await readGraph(
        `query q($repo: string) { tc(func: eq(TestChunk.repo, $repo)) { TestChunk.file_path } }`,
        { $repo: scopeKey },
      )) as { tc?: unknown[] }
    ).tc ?? [];

  it("writes the run's test chunks under the run-scoped key, not the repo key", async () => {
    const repo = `spec-trace/${randomUUID()}`;
    const runId = randomUUID();

    await ingestSpecTrace(client, repo, "test-report", report(runId));

    expect(await testChunksOf(`${repo}|run:${runId}`)).not.toEqual([]);
    expect(await testChunksOf(repo)).toEqual([]);

    await dropOverlay(client, repo, runId);
  });

  it("stamps the overlay with the branch and head commit the report was posted for", async () => {
    const repo = `spec-trace/${randomUUID()}`;
    const runId = randomUUID();

    await ingestSpecTrace(client, repo, "test-report", report(runId));

    expect(await readOverlay(client, repo, runId)).toMatchObject({
      branch: "lore/impl/issue-9",
      headCommit: "branchsha",
    });

    await dropOverlay(client, repo, runId);
  });

  it("leaves Repo.trace_commit alone so a branch push cannot move main's coordinate system", async () => {
    const repo = `spec-trace/${randomUUID()}`;
    const runId = randomUUID();

    await upsertByXid(client, "Repo", repo, {
      "Repo.trace_commit": "mainsha",
      "Repo.trace_commit_at": "2026-01-01T00:00:00.000Z",
    });
    await ingestSpecTrace(client, repo, "test-report", report(runId));

    expect(await readGraphBaseline(client, repo)).toMatchObject({
      commit: "mainsha",
    });

    await dropOverlay(client, repo, runId);
  });

  it("writes no validated_by onto the main statement the branch test claims", async () => {
    const repo = `spec-trace/${randomUUID()}`;
    const runId = randomUUID();
    const statementXid = `${repo}|specs/widget/spec.md|1`;

    await upsertByXid(client, "Statement", statementXid, {
      "Statement.repo": repo,
      "Statement.text": "The widget adds.",
    });
    await ingestSpecTrace(client, repo, "test-report", report(runId));

    const graph = (await readGraph(
      `query q($xid: string) { s(func: eq(Statement.xid, $xid)) { vb: Statement.validated_by { uid } } }`,
      { $xid: statementXid },
    )) as { s?: { vb?: unknown[] }[] };

    expect(graph.s?.[0]?.vb).toBeUndefined();

    await dropOverlay(client, repo, runId);
  });

  it("still writes main's test chunks and baseline when the report names no run", async () => {
    const repo = `spec-trace/${randomUUID()}`;

    await ingestSpecTrace(client, repo, "test-report", report());

    expect(await testChunksOf(repo)).not.toEqual([]);
    expect(await readGraphBaseline(client, repo)).toMatchObject({
      commit: "branchsha",
    });
  });
});
