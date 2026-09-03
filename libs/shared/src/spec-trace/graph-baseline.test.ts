import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { findRepoRoot } from "../lib/repo-root.js";
import { randomUUID } from "node:crypto";
import * as dgraph from "dgraph-js-http";
import { readGraphBaseline, stampGraphBaseline } from "./graph-baseline.js";
import { ingestCoverageReport } from "./ingest-coverage.js";

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

/**
 * graph-baseline — the commit whose line numbering the trace graph's ranges are
 * expressed in. Stamped by whichever ingest writes those ranges (coverage), read
 * back by the pre-merge impact query so it can align a PR diff to the same
 * coordinate system instead of silently overlapping two different ones.
 */
describe.skipIf(!reachable)("graph baseline (live Dgraph)", () => {
  const dgraphClient = new dgraph.DgraphClient(
    new dgraph.DgraphClientStub(DGRAPH_HTTP),
  );
  let repo: string;

  beforeAll(() => {
    execFileSync("bash", [APPLIER], {
      env: { ...process.env, DGRAPH_HTTP },
      stdio: "pipe",
    });
  });

  afterEach(async () => {
    const txn = dgraphClient.newTxn();

    try {
      const res = await txn.queryWithVars(
        `query nodes($repo: string) {
          repos(func: eq(Repo.xid, $repo)) { uid }
          covs(func: eq(Coverage.repo, $repo)) { uid }
          files(func: eq(File.repo, $repo)) { uid }
          chunks(func: eq(TestChunk.repo, $repo)) { uid }
        }`,
        { $repo: repo },
      );
      const written = res.data as Record<string, { uid: string }[]>;
      const uids = Object.values(written)
        .flat()
        .map((n) => n.uid);

      if (uids.length) {
        await txn.mutate({
          deleteNquads: uids.map((uid) => `<${uid}> * * .`).join("\n"),
          commitNow: true,
        });
      }
    } catch {
      /* best-effort cleanup */
    } finally {
      await txn.discard().catch(() => {});
    }
  });

  it("reads back the commit and timestamp that were stamped", async () => {
    repo = `acme/baseline-${randomUUID()}`;
    const at = new Date("2026-08-07T10:30:00.000Z");

    await stampGraphBaseline(dgraphClient, repo, "8f2a1c3", at);

    expect(await readGraphBaseline(dgraphClient, repo)).toEqual({
      commit: "8f2a1c3",
      at: "2026-08-07T10:30:00.000Z",
      source: "repo-stamp",
    });
  });

  it("returns a null baseline for a repo that was never stamped", async () => {
    repo = `acme/unstamped-${randomUUID()}`;

    expect(await readGraphBaseline(dgraphClient, repo)).toEqual({
      commit: null,
      at: null,
      source: "none",
    });
  });

  it("stamps the baseline from the commit a coverage ingest wrote its ranges at", async () => {
    repo = `acme/coverage-${randomUUID()}`;

    await ingestCoverageReport(
      dgraphClient,
      { repo, tool: "lcov", commit: "c0ffee1" },
      [
        {
          testFile: "src/widget.test.ts",
          testName: "renders",
          covered: [{ file: "src/widget.ts", startLine: 1, endLine: 5 }],
        },
      ],
    );

    expect(await readGraphBaseline(dgraphClient, repo)).toMatchObject({
      commit: "c0ffee1",
      source: "repo-stamp",
    });
  });

  it("leaves the previous baseline intact when the commit is empty", async () => {
    repo = `acme/empty-commit-${randomUUID()}`;
    const at = new Date("2026-08-07T10:30:00.000Z");

    await stampGraphBaseline(dgraphClient, repo, "8f2a1c3", at);
    await stampGraphBaseline(dgraphClient, repo, "", new Date());

    expect(await readGraphBaseline(dgraphClient, repo)).toMatchObject({
      commit: "8f2a1c3",
    });
  });
});
