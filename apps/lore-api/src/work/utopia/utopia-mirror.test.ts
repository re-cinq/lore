import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { Pool } from "pg";
import { metrics } from "@opentelemetry/api";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
  type DataPoint,
} from "@opentelemetry/sdk-metrics";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { makePool } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import { mirrorSource, sourceToMirror } from "./utopia-mirror.js";

const ENV = { UTOPIA_API_URL: "http://utopia.test" };
const SETTINGS = {
  utopia: { kb_id: "kb-1", source_id: "src-1", ontology_version: 4 },
};
const SETTINGS_V1 = {
  utopia: { kb_id: "kb-1", source_id: "src-1", ontology_version: 1 },
};
const STORED = { id: "src-1", key: "utp_k", kbId: "kb-1" };

describe("mirrorSource", () => {
  it("pushes through the stored src-1 key when settings.utopia names src-1 and UTOPIA_API_URL is set", () => {
    expect(mirrorSource(SETTINGS, STORED, ENV)).toEqual({
      id: "src-1",
      key: "utp_k",
    });
  });

  it("is null without UTOPIA_API_URL, without a utopia block, without a stored key, and with a key stored for another source", () => {
    expect([
      mirrorSource(SETTINGS, STORED, {}),
      mirrorSource({ auto_review: true }, STORED, ENV),
      mirrorSource(SETTINGS, null, ENV),
      mirrorSource(SETTINGS, { ...STORED, id: "src-2" }, ENV),
    ]).toEqual([null, null, null, null]);
  });
});

const seen: string[] = [];
let refusedPaths: string[] = [];
let server: Server;
let autoEnv: Record<string, string>;

const ANSWERS: Record<string, unknown> = {
  "GET /api/v1/workspaces/ws-lore/kbs": [],
  "POST /api/v1/workspaces/ws-lore/kbs": { id: "kb-new", name: "re-cinq/lore" },
  "POST /api/v1/kbs/kb-new/ontology/imports": { import_id: "imp-1", plan: {} },
  "POST /api/v1/kbs/kb-1/ontology/imports": { import_id: "imp-2", plan: {} },
  "POST /api/v1/kbs/kb-new/sources": {
    ingest_token: "utp_new",
    source: { id: "src-new" },
  },
};

const statusOf = (key: string): number => {
  if (refusedPaths.some((path) => key.endsWith(path))) {
    return 403;
  }

  return key in ANSWERS || key.includes("/kind-words/") ? 200 : 404;
};

beforeAll(async () => {
  server = createServer((req, res) => {
    const key = `${req.method} ${req.url}`;

    seen.push(`${key} ${req.headers.authorization}`);
    req.resume();
    res.setHeader("content-type", "application/json");
    res.statusCode = statusOf(key);
    res.end(JSON.stringify(ANSWERS[key] ?? { ok: true }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();

  enforceTrue(
    !(addr === null || typeof addr === "string"),
    Error,
    "no server address",
  );
  autoEnv = {
    UTOPIA_API_URL: `http://127.0.0.1:${addr.port}`,
    UTOPIA_TOKEN: "utp_pat_lore",
    UTOPIA_WORKSPACE_ID: "ws-lore",
  };
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

beforeEach(() => {
  seen.length = 0;
  refusedPaths = [];
});

const writesOf = (pool: ReturnType<typeof makePool>) =>
  pool.query.mock.calls
    .map(([sql, params]) => [String(sql), params as string[]] as const)
    .filter(([sql]) => /^\s*(INSERT|UPDATE)/.test(sql))
    .map(([sql, params]) =>
      /UPDATE lore\.repos/.test(sql) ? JSON.parse(params[0]) : params,
    );

const setUpCalls = () => seen.filter((call) => !call.includes("/kind-words/"));

const mirrorOf = (
  pool: ReturnType<typeof makePool>,
  repo: string,
  settings: Record<string, unknown> | null,
  env: Record<string, string> = autoEnv,
) => sourceToMirror(pool as unknown as Pool, repo, settings, env);

describe("sourceToMirror", () => {
  it("sets re-cinq/lore up in ws-lore under the utp_pat_lore token on its first ingest, saves the key and the settings, and answers src-new", async () => {
    const pool = makePool();
    const source = await mirrorOf(pool, "re-cinq/lore", null);

    expect({ source, calls: setUpCalls(), writes: writesOf(pool) }).toEqual({
      source: { id: "src-new", key: "utp_new" },
      calls: [
        "GET /api/v1/workspaces/ws-lore/kbs Bearer utp_pat_lore",
        "POST /api/v1/workspaces/ws-lore/kbs Bearer utp_pat_lore",
        "POST /api/v1/kbs/kb-new/ontology/imports Bearer utp_pat_lore",
        "POST /api/v1/kbs/kb-new/sources Bearer utp_pat_lore",
      ],
      writes: [
        ["re-cinq/lore", "kb-new", "src-new", "utp_new"],
        {
          utopia: {
            kb_id: "kb-new",
            source_id: "src-new",
            ontology_version: 4,
          },
        },
      ],
    });
  });

  it("shares one setup between two concurrent first ingests of re-cinq/lore: one knowledge base, one source, one saved key", async () => {
    const pool = makePool();
    const sources = await Promise.all([
      mirrorOf(pool, "re-cinq/lore", null),
      mirrorOf(pool, "re-cinq/Lore", null),
    ]);

    expect({
      sources,
      created: setUpCalls().filter((call) => call.startsWith("POST")).length,
      saved: writesOf(pool).filter(Array.isArray).length,
    }).toEqual({
      sources: [
        { id: "src-new", key: "utp_new" },
        { id: "src-new", key: "utp_new" },
      ],
      created: 3,
      saved: 1,
    });
  });

  it("answers the stored src-1 without calling Utopia when settings already name it at ontology version 4", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({
      rows: [{ kb_id: "kb-1", source_id: "src-1", source_key: "utp_k" }],
    });
    const source = await mirrorOf(pool, "re-cinq/lore", SETTINGS);

    expect({ source, calls: seen }).toEqual({
      source: { id: "src-1", key: "utp_k" },
      calls: [],
    });
  });

  it("is null and calls Utopia for nothing on a deployment without UTOPIA_TOKEN", async () => {
    const source = await mirrorOf(makePool(), "re-cinq/lore", null, {
      ...autoEnv,
      UTOPIA_TOKEN: "",
    });

    expect({ source, calls: seen }).toEqual({ source: null, calls: [] });
  });

  it("rejects with Utopia's 403 and stores nothing when the knowledge base listing is refused, and the next ingest sets re-cinq/lore up", async () => {
    const pool = makePool();

    refusedPaths = ["/kbs"];
    const failure = await mirrorOf(pool, "re-cinq/lore", null).catch(
      (error: Error) => error.message,
    );
    const writesAfterFailure = writesOf(pool).length;

    refusedPaths = [];
    const retried = await mirrorOf(pool, "re-cinq/lore", null);

    expect({ failure, writesAfterFailure, retried }).toEqual({
      failure: "utopia answered 403: []",
      writesAfterFailure: 0,
      retried: { id: "src-new", key: "utp_new" },
    });
  });
});

const reader = new PeriodicExportingMetricReader({
  exporter: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
  exportIntervalMillis: 60_000,
});

metrics.setGlobalMeterProvider(new MeterProvider({ readers: [reader] }));

const mirrorFailures = async (): Promise<Array<DataPoint<unknown>>> => {
  const { resourceMetrics } = await reader.collect();

  return resourceMetrics.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .filter(
      ({ descriptor }) => descriptor.name === "lore.utopia.mirror_failures",
    )
    .flatMap((metric) => metric.dataPoints as Array<DataPoint<unknown>>);
};

const storedSrc1 = () => {
  const pool = makePool();

  pool.query.mockResolvedValue({
    rows: [{ kb_id: "kb-1", source_id: "src-1", source_key: "utp_k" }],
  });

  return pool;
};

describe("sourceToMirror on a base set up at ontology version 1", () => {
  it("re-imports the ontology into kb-1 once for two concurrent ingests, binds the fourteen kind words, stores version 4, and answers src-1", async () => {
    const pool = storedSrc1();
    const sources = await Promise.all([
      mirrorOf(pool, "re-cinq/lore", SETTINGS_V1),
      mirrorOf(pool, "re-cinq/Lore", SETTINGS_V1),
    ]);

    expect({
      sources,
      calls: setUpCalls(),
      bound: seen.length - setUpCalls().length,
      writes: writesOf(pool),
    }).toEqual({
      sources: [
        { id: "src-1", key: "utp_k" },
        { id: "src-1", key: "utp_k" },
      ],
      calls: ["POST /api/v1/kbs/kb-1/ontology/imports Bearer utp_pat_lore"],
      bound: 14,
      writes: [SETTINGS],
    });
  });

  it("answers src-1 and calls Utopia for nothing when the deployment has no UTOPIA_TOKEN, leaving version 1 stored", async () => {
    const pool = storedSrc1();
    const source = await mirrorOf(pool, "re-cinq/lore", SETTINGS_V1, {
      ...autoEnv,
      UTOPIA_TOKEN: "",
    });

    expect({ source, calls: seen, writes: writesOf(pool) }).toEqual({
      source: { id: "src-1", key: "utp_k" },
      calls: [],
      writes: [],
    });
  });

  it("answers src-1 and counts one mirror failure for re-cinq/lore when Utopia refuses the import with 403, leaving version 1 stored", async () => {
    const pool = storedSrc1();
    const before = (await mirrorFailures()).length;

    refusedPaths = ["/ontology/imports"];
    const source = await mirrorOf(pool, "re-cinq/lore", SETTINGS_V1);

    expect({
      source,
      writes: writesOf(pool),
      before,
      failures: await mirrorFailures(),
    }).toMatchObject({
      source: { id: "src-1", key: "utp_k" },
      writes: [],
      before: 0,
      failures: [{ attributes: { repo: "re-cinq/lore" }, value: 1 }],
    });
  });
});
