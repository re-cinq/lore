import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import * as dgraph from "dgraph-js-http";
import { findRepoRoot } from "../../lib/repo-root.js";
import { dgraphReachable } from "../../lib/dgraph-test-gate.js";
import { makeDeleteRepoNodes } from "../../outbound/spec-trace/test-helpers/delete-repo-nodes.js";
import type { DgraphClientPort } from "../../outbound/memory-store.js";
import { mainScope } from "../../domain/spec-trace/trace-scope.js";
import {
  coverageRecordsFor,
  ingestTestReport,
  type TestReport,
} from "./ingest-test-report.js";
import { readStoredTestLayer } from "./read-stored-test-layer.js";
import { layerKeysOf, type StoredTestLayer } from "./stored-test-layer.js";

const DGRAPH_HTTP = process.env.DGRAPH_HTTP ?? "http://localhost:8081";
const APPLIER = join(
  findRepoRoot(),
  "scripts",
  "infra",
  "setup-spec-trace-schema.sh",
);
const PANEL = "src/app/[id]/panel.test.tsx";
const CLOCK = "src/clock.test.ts";
const FIRST_COMMIT = "a".repeat(40);
const NEXT_COMMIT = "b".repeat(40);

const REPORT: TestReport = {
  commit: FIRST_COMMIT,
  branch: "main",
  tests: [
    {
      id: `${PANEL}::Panel > renders`,
      name: "Panel > renders",
      file: PANEL,
      startLine: 3,
      endLine: 5,
      suite: ["Panel"],
    },
    {
      id: `${PANEL}::Panel > closes`,
      name: "Panel > closes",
      file: PANEL,
      startLine: 7,
      endLine: 9,
      suite: ["Panel"],
    },
    {
      id: `${CLOCK}::ticks`,
      name: "ticks",
      file: CLOCK,
      startLine: 1,
      endLine: 3,
    },
  ],
  results: [
    {
      id: `${PANEL}::Panel > renders`,
      passed: true,
      covered: [{ file: "src/app/[id]/panel.tsx", startLine: 1, endLine: 4 }],
    },
    {
      id: `${PANEL}::Panel > closes`,
      passed: true,
      covered: [{ file: "src/app/[id]/panel.tsx", startLine: 6, endLine: 8 }],
    },
    {
      id: `${CLOCK}::ticks`,
      passed: true,
      covered: [{ file: "src/clock.ts", startLine: 2, endLine: 5 }],
    },
  ],
};

const reachable = await dgraphReachable();

describe.skipIf(!reachable)(
  "ingestTestReport skips what the graph holds (live Dgraph)",
  () => {
    const dgraphClient = new dgraph.DgraphClient(
      new dgraph.DgraphClientStub(DGRAPH_HTTP),
    );
    const deleteRepoNodes = makeDeleteRepoNodes(dgraphClient, [
      { alias: "chunks", type: "TestChunk" },
      { alias: "suites", type: "TestSuite" },
      { alias: "coverages", type: "Coverage" },
      { alias: "files", type: "File" },
      { alias: "root", type: "Repo", field: "xid" },
    ]);
    let createdRepo = "";

    beforeAll(() => {
      execFileSync("bash", [APPLIER], {
        env: { ...process.env, DGRAPH_HTTP },
        stdio: "pipe",
      });
    });

    afterEach(async () => {
      if (createdRepo) {
        await deleteRepoNodes(createdRepo);
      }
    });

    function newRepo(): string {
      createdRepo = `test-proj/${randomUUID()}`;

      return createdRepo;
    }

    async function ingest(repo: string, report: TestReport) {
      const counting = countingUpserts(dgraphClient);

      await ingestTestReport(counting.port, mainScope(repo), report);

      return counting.upsertedTypes();
    }

    async function stored(
      repo: string,
      report: TestReport = REPORT,
    ): Promise<StoredTestLayer> {
      const scope = mainScope(repo);

      return readStoredTestLayer(
        dgraphClient,
        scope,
        layerKeysOf(scope, report.tests, coverageRecordsFor(report)),
      );
    }

    it("reads back the five tests, the suite and the ticks coverage's 2-5 ranges an ingest wrote, under a path that holds brackets", async () => {
      const repo = newRepo();

      await ingest(repo, REPORT);
      const layer = await stored(repo);

      expect({
        chunks: layer.chunks.size,
        suites: layer.suites.size,
        ticks: layer.coverage
          .get(`${repo}|${CLOCK}|ticks`)
          ?.covers.get("src/clock.ts")?.ranges,
      }).toEqual({ chunks: 5, suites: 1, ticks: "2-5" });
    });

    it("writes no test, suite, coverage or file node when the same report comes again, and every node keeps its uid", async () => {
      const repo = newRepo();

      await ingest(repo, REPORT);
      const before = await stored(repo);
      const upserted = await ingest(repo, REPORT);

      expect({ upserted, after: await stored(repo) }).toEqual({
        upserted: [],
        after: before,
      });
    });

    it("rewrites only the clock file's two coverage nodes and its covered file when the ticks ranges grow from 2-5 to 2-6, and the graph then holds 2-6", async () => {
      const repo = newRepo();
      const grown = {
        ...REPORT,
        results: REPORT.results.map((result) =>
          result.id === `${CLOCK}::ticks`
            ? {
                ...result,
                covered: [{ file: "src/clock.ts", startLine: 2, endLine: 6 }],
              }
            : result,
        ),
      };

      await ingest(repo, REPORT);
      const upserted = await ingest(repo, grown);
      const layer = await stored(repo);

      expect({
        upserted: [...upserted].sort(),
        ticks: layer.coverage
          .get(`${repo}|${CLOCK}|ticks`)
          ?.covers.get("src/clock.ts")?.ranges,
      }).toEqual({ upserted: ["Coverage", "Coverage", "File"], ticks: "2-6" });
    });

    it("reads back a test whose name holds quotes, a backslash, a $& and an emoji, and writes nothing for it the second time", async () => {
      const repo = newRepo();
      const name = 'says "hi" \\ costs $& 🎉';
      const odd: TestReport = {
        commit: FIRST_COMMIT,
        branch: "main",
        tests: [
          { id: `src/odd.test.ts::${name}`, name, file: "src/odd.test.ts" },
        ],
        results: [
          {
            id: `src/odd.test.ts::${name}`,
            passed: true,
            covered: [{ file: "src/odd.ts", startLine: 1, endLine: 2 }],
          },
        ],
      };

      await ingest(repo, odd);
      const upserted = await ingest(repo, odd);
      const layer = await stored(repo, odd);

      expect({
        upserted,
        name: layer.chunks.get(`${repo}|src/odd.test.ts::${name}`)?.name,
      }).toEqual({ upserted: [], name });
    });

    it("brings all five kept coverage nodes to the new commit when the same tests come at another commit", async () => {
      const repo = newRepo();

      await ingest(repo, REPORT);
      await ingest(repo, { ...REPORT, commit: NEXT_COMMIT });
      const commits = [...(await stored(repo)).coverage.values()].map(
        (coverage) => coverage.commit,
      );

      expect(commits).toEqual(Array(5).fill(NEXT_COMMIT));
    });
  },
);

function countingUpserts(client: DgraphClientPort): {
  port: DgraphClientPort;
  upsertedTypes: () => string[];
} {
  const types: string[] = [];
  const port: DgraphClientPort = {
    newTxn: () => {
      const txn = client.newTxn();

      return {
        queryWithVars: (query, vars) => {
          const type = /found\(func: eq\((\w+)\.xid/.exec(query)?.[1];

          if (type !== undefined && type !== "Repo") {
            types.push(type);
          }

          return txn.queryWithVars(query, vars);
        },
        mutate: (request) => txn.mutate(request),
        discard: () => txn.discard(),
      };
    },
  };

  return { port, upsertedTypes: () => types };
}
