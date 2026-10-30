import { beforeAll, afterAll, describe, expect, it } from "vitest";
import Hapi, { type ResponseToolkit } from "@hapi/hapi";
import pg from "pg";
import { readFileSync } from "node:fs";
import { PgTestReports } from "@re-cinq/lore-shared/project/test-reports/test-reports-pg.js";
import { ingestDeltaRoute } from "../transport/routes/ingest/ingest-delta.js";
import { defaultDeps } from "../transport/routes/ingest/ingest-delta-deps.js";

describe("triage report evidence", () => {
  const repo = "triage-evidence/integration";
  const commit = "a".repeat(40);
  const pool = new pg.Pool({
    host: process.env.LORE_DB_HOST || "localhost",
    port: Number(process.env.LORE_DB_PORT || 5432),
    database: process.env.LORE_DB_NAME || "lore_test",
    user: process.env.LORE_DB_USER || "lore",
    password: process.env.LORE_DB_PASSWORD || "test",
  });
  const server = Hapi.server();
  const reports = new PgTestReports(pool);
  const descriptor = (id: string, file: string, status = "passed") => ({
    id,
    name: id,
    file,
    runnerId: JSON.stringify([file, "", id]),
    execution: {
      status,
      expectedFailure: false,
      fileCaseCount: 1,
      location: { line: 1, column: 1 },
    },
  });
  const post = (
    tests: ReturnType<typeof descriptor>[],
    innerCommit = commit,
    seq = 1,
  ) =>
    server.inject({
      method: "POST",
      url: "/api/repos/triage-evidence/integration/ingest",
      payload: {
        kind: "test-report",
        commit,
        base_commit: null,
        seq,
        total: 2,
        report: {
          commit: innerCommit,
          branch: "main",
          tests,
          results: tests
            .filter((test) => test.execution.status === "passed")
            .map((test) => ({ id: test.id, passed: true })),
        },
      },
    });

  beforeAll(async () => {
    await pool.query("CREATE SCHEMA IF NOT EXISTS pipeline");
    await pool.query(
      readFileSync(
        new URL(
          "../../../../infra/terraform/modules/gke-mcp/lore-platform/charts/ui-helm/migrations/0069_test_reports.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await pool.query("DELETE FROM pipeline.test_reports WHERE repo = $1", [
      repo,
    ]);
    server.auth.scheme("stub", () => ({
      authenticate: (_request: unknown, h: ResponseToolkit) =>
        h.authenticated({ credentials: {} }),
    }));
    server.auth.strategy("bearer-scope", "stub");
    server.route(
      ingestDeltaRoute(() => pool, {
        ...defaultDeps(),
        dgraph: () => ({}) as never,
        defaultBranch: async () => "main",
        ingestReport: async () => ({
          kind: "test-report",
          testChunks: 1,
          validatedBy: 0,
          violated: 0,
          coverageNodes: 0,
          coversEdges: 0,
        }),
        mirrorReport: async () => undefined,
        markIngested: async () => undefined,
      }),
    );
  });

  afterAll(async () => {
    await pool.query("DELETE FROM pipeline.test_reports WHERE repo = $1", [
      repo,
    ]);
    await server.stop();
    await pool.end();
  });

  it("retains two main chunks and replaces a passing file with its skipped rerun", async () => {
    const responses = [
      await post([descriptor("old", "a.test.ts")]),
      await post([descriptor("second", "b.test.ts")]),
      await post([descriptor("skipped", "a.test.ts", "skipped")]),
      await post([descriptor("skipped", "a.test.ts", "skipped")]),
    ];
    const report = await reports.forCommit(repo, commit);

    expect(responses.map((response) => response.statusCode)).toEqual([
      200, 200, 200, 200,
    ]);
    expect({
      tests: report?.tests.map((test) => ({
        id: test.id,
        execution: test.execution,
      })),
      outcomes: report?.outcomes,
    }).toEqual({
      tests: [
        {
          id: "second",
          execution: descriptor("second", "b.test.ts").execution,
        },
        {
          id: "skipped",
          execution: descriptor("skipped", "a.test.ts", "skipped").execution,
        },
      ],
      outcomes: { second: true },
    });
    expect(report).toMatchObject({ repo, commit, branch: "main" });
  });

  it("rejects execution from commit b before writing commit a", async () => {
    const response = await post(
      [descriptor("wrong-commit", "c.test.ts")],
      "b".repeat(40),
    );

    expect(response.statusCode).toEqual(400);
    expect(
      (await reports.forCommit(repo, commit))?.tests.some(
        (test) => test.id === "wrong-commit",
      ),
    ).toEqual(false);
  });

  it("rejects split-file parts without losing the recorded failed sibling", async () => {
    const failed = descriptor("failed", "split.test.ts", "failed");
    const passed = descriptor("passed", "split.test.ts");

    failed.execution.fileCaseCount = 2;
    passed.execution.fileCaseCount = 2;
    const initial = await post([failed, passed]);
    const parts = [await post([failed]), await post([passed], commit, 2)];
    const report = await reports.forCommit(repo, commit);

    expect([
      initial.statusCode,
      ...parts.map((part) => part.statusCode),
    ]).toEqual([200, 400, 400]);
    expect(
      report?.tests
        .filter((test) => test.file === "split.test.ts")
        .map((test) => ({ id: test.id, status: test.execution?.status })),
    ).toEqual([
      { id: "failed", status: "failed" },
      { id: "passed", status: "passed" },
    ]);
  });
});
