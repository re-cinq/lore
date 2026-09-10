import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "@hapi/hapi";
import pg from "pg";
import { PgAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-pg.js";
import { signRunCredential } from "@re-cinq/lore-shared/github-credential/run-credential.js";
import { buildServer } from "../app/build-server.js";
import { restoreEnv } from "./restore-env.js";

const INGEST_TOKEN = "integration-ingest-token";
const REPO = "test/credential-repo";

describe("the git-credential broker, against real Postgres", () => {
  let pool: pg.Pool;
  let server: Server;
  let runs: PgAssemblyRuns;
  const prevIngest = process.env.LORE_INGEST_TOKEN;
  const runIds: string[] = [];

  beforeAll(async () => {
    process.env.LORE_INGEST_TOKEN = INGEST_TOKEN;
    pool = new pg.Pool({
      host: process.env.LORE_DB_HOST || "localhost",
      port: parseInt(process.env.LORE_DB_PORT || "5432"),
      database: process.env.LORE_DB_NAME || "lore_test",
      user: process.env.LORE_DB_USER || "lore",
      password: process.env.LORE_DB_PASSWORD || "test",
    });
    await pool.query("SELECT 1");
    runs = new PgAssemblyRuns(pool);
    server = buildServer(() => pool);
  });

  afterAll(async () => {
    await pool.query(
      "DELETE FROM pipeline.station_runs WHERE assembly_run_id = ANY($1::uuid[])",
      [runIds],
    );
    await pool.query(
      "DELETE FROM pipeline.assembly_runs WHERE id = ANY($1::uuid[])",
      [runIds],
    );
    await server.stop();
    await pool.end();

    restoreEnv("LORE_INGEST_TOKEN", prevIngest);
  });

  it("refuses a credential signed with another key with 401 bad-signature over HTTP", async () => {
    const runId = await runs.start({
      blueprintName: "implementation-loop",
      repo: REPO,
    });

    runIds.push(runId);
    const { stationRunId } = await runs.ensureStationRun({
      assemblyRunId: runId,
      nodeId: "fix-ci",
      iteration: 1,
    });
    const forged = signRunCredential(
      {
        stationRunId,
        repo: REPO,
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
      "another-key",
    );

    const res = await server.inject({
      method: "POST",
      url: "/api/github-credentials",
      headers: { authorization: `Bearer ${forged}` },
      payload: { repo: REPO },
    });

    expect({
      statusCode: res.statusCode,
      body: JSON.parse(res.payload) as unknown,
    }).toEqual({ statusCode: 401, body: { error: "bad-signature" } });
  });
});
