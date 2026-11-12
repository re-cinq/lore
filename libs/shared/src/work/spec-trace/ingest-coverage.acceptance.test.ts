import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { findRepoRoot } from "../../lib/repo-root.js";
import { randomUUID } from "node:crypto";
import * as dgraph from "dgraph-js-http";
import { ingestCoverageReport } from "./ingest-coverage.js";
import { makeDeleteRepoNodes } from "../../outbound/spec-trace/test-helpers/delete-repo-nodes.js";
import { dgraphReachable } from "../../lib/dgraph-test-gate.js";
import { mainScope } from "../../domain/spec-trace/trace-scope.js";
import { readStoredTestLayer } from "./stored-test-layer.js";

const DGRAPH_HTTP = process.env.DGRAPH_HTTP ?? "http://localhost:8081";
const APPLIER = join(
  findRepoRoot(),
  "scripts",
  "infra",
  "setup-spec-trace-schema.sh",
);

const reachable = await dgraphReachable();

describe.skipIf(!reachable)("ingestCoverageReport idempotency", () => {
  const dgraphClient = new dgraph.DgraphClient(
    new dgraph.DgraphClientStub(DGRAPH_HTTP),
  );

  beforeAll(() => {
    execFileSync("bash", [APPLIER], {
      env: { ...process.env, DGRAPH_HTTP },
      stdio: "pipe",
    });
  });

  const deleteRepoNodes = makeDeleteRepoNodes(dgraphClient, [
    { alias: "coverage", type: "Coverage" },
    { alias: "codechunks", type: "CodeChunk" },
    { alias: "testchunks", type: "TestChunk" },
    { alias: "files", type: "File" },
    { alias: "root", type: "Repo", field: "xid" },
  ]);

  let createdRepo = "";

  afterEach(async () => {
    if (createdRepo) {
      await deleteRepoNodes(createdRepo);
    }
  });

  function withMutationCounter(client: typeof dgraphClient): {
    countingClient: Parameters<typeof ingestCoverageReport>[0];
    getCounts: () => { mutations: number };
    resetCounts: () => void;
  } {
    let mutations = 0;
    const countingClient = {
      newTxn() {
        const txn = client.newTxn();

        return {
          queryWithVars: txn.queryWithVars.bind(txn),
          mutate(mu: any) {
            mutations++;

            return txn.mutate(mu);
          },
          discard: txn.discard.bind(txn),
        };
      },
    } as unknown as Parameters<typeof ingestCoverageReport>[0];

    return {
      countingClient,
      getCounts: () => ({ mutations }),
      resetCounts: () => {
        mutations = 0;
      },
    };
  }

  it("performs no writes at the same commit, but a new commit replaces targets without duplicates", async () => {
    const repo = `test-cov/${randomUUID()}`;

    createdRepo = repo;
    const scope = mainScope(repo);

    const records = [
      {
        testFile: "t.test.ts",
        testName: "renders",
        covered: [{ file: "src/widget.ts", startLine: 5, endLine: 10 }],
      },
    ];

    await ingestCoverageReport(
      dgraphClient,
      { scope, tool: "lcov", commit: "commit-1" },
      records,
    );

    const { countingClient, getCounts, resetCounts } =
      withMutationCounter(dgraphClient);

    const stored1 = await readStoredTestLayer(dgraphClient, scope);

    await ingestCoverageReport(
      countingClient,
      { scope, tool: "lcov", commit: "commit-1" },
      records,
      stored1,
    );
    expect(getCounts().mutations).toBe(0);

    resetCounts();
    const stored2 = await readStoredTestLayer(dgraphClient, scope);

    await ingestCoverageReport(
      countingClient,
      { scope, tool: "lcov", commit: "commit-2" },
      records,
      stored2,
    );
    
    resetCounts();
    const recordsMod = [
      {
        testFile: "t.test.ts",
        testName: "renders",
        covered: [{ file: "src/widget.ts", startLine: 5, endLine: 12 }],
      },
    ];
    const stored3 = await readStoredTestLayer(dgraphClient, scope);

    await ingestCoverageReport(
      countingClient,
      { scope, tool: "lcov", commit: "commit-3" },
      recordsMod,
      stored3,
    );
    expect(getCounts().mutations).toBeGreaterThan(0);

    const txn = dgraphClient.newTxn();

    try {
      const res = await txn.queryWithVars(
        `query q($repo: string) { cov(func: eq(Coverage.repo, $repo)) { Coverage.commit Coverage.covers { File.path } Coverage.covers@facets(ranges) } }`,
        { $repo: repo },
      );
      const covs = (res.data as any).cov;

      expect(covs).toMatchObject([
        {
          "Coverage.commit": "commit-3",
          "Coverage.covers": [
            {
              "Coverage.covers|ranges": "5-12",
            },
          ],
        },
      ]);
    } finally {
      await txn.discard().catch(() => {});
    }
  });
});
