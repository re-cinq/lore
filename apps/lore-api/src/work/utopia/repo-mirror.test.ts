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
import { knowledgeBaseToMirror } from "./repo-mirror.js";

const ENV = { UTOPIA_API_URL: "http://utopia.test" };
const SETTINGS = { utopia: { kb_id: "kb-1", ontology_version: 7 } };
const SETTINGS_V1 = { utopia: { kb_id: "kb-1", ontology_version: 1 } };

const seen: string[] = [];
let refusedPaths: string[] = [];
let server: Server;
let autoEnv: Record<string, string>;

const ANSWERS: Record<string, unknown> = {
  "GET /api/v1/workspaces/ws-lore/kbs": [],
  "POST /api/v1/workspaces/ws-lore/kbs": { id: "kb-new", name: "re-cinq/lore" },
  "POST /api/v1/kbs/kb-new/ontology/imports": { import_id: "imp-1", plan: {} },
  "POST /api/v1/kbs/kb-1/ontology/imports": { import_id: "imp-2", plan: {} },
  "PATCH /api/v1/kbs/kb-1/sources/src-git-history": { id: "src-git-history" },
  "PATCH /api/v1/kbs/kb-1/sources/src-github": { id: "src-github" },
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
      /UPDATE lore\.repos/.test(sql)
        ? { utopia: JSON.parse(params[0]) }
        : params,
    );

const setUpCalls = () => seen.filter((call) => !call.includes("/kind-words/"));

const mirrorOf = (
  pool: ReturnType<typeof makePool>,
  repo: string,
  settings: Record<string, unknown> | null,
  env: Record<string, string> = autoEnv,
) => knowledgeBaseToMirror(pool as unknown as Pool, repo, settings, env);

describe("knowledgeBaseToMirror", () => {
  it("answers kb-1 without calling Utopia or writing when settings.utopia names kb-1 at ontology version 7", async () => {
    const pool = makePool();
    const kbId = await mirrorOf(pool, "re-cinq/lore", SETTINGS);

    expect({ kbId, calls: seen, writes: writesOf(pool) }).toEqual({
      kbId: "kb-1",
      calls: [],
      writes: [],
    });
  });

  it("is null without UTOPIA_API_URL, and without a utopia block on a deployment without UTOPIA_TOKEN", async () => {
    const pool = makePool();

    expect([
      await mirrorOf(pool, "re-cinq/lore", SETTINGS, {}),
      await mirrorOf(pool, "re-cinq/lore", { auto_review: true }, ENV),
    ]).toEqual([null, null]);
  });

  it("sets re-cinq/lore up in ws-lore under the utp_pat_lore token on its first ingest, creates no source, saves kb-new to lore.utopia_bases and the settings, and answers kb-new", async () => {
    const pool = makePool();
    const kbId = await mirrorOf(pool, "re-cinq/lore", null);

    expect({ kbId, calls: setUpCalls(), writes: writesOf(pool) }).toEqual({
      kbId: "kb-new",
      calls: [
        "GET /api/v1/workspaces/ws-lore/kbs Bearer utp_pat_lore",
        "POST /api/v1/workspaces/ws-lore/kbs Bearer utp_pat_lore",
        "POST /api/v1/kbs/kb-new/ontology/imports Bearer utp_pat_lore",
      ],
      writes: [
        ["re-cinq/lore", "kb-new"],
        { utopia: { kb_id: "kb-new", ontology_version: 7 } },
      ],
    });
  });

  it("shares one setup between two concurrent first ingests of re-cinq/lore: one knowledge base, one saved base", async () => {
    const pool = makePool();
    const kbIds = await Promise.all([
      mirrorOf(pool, "re-cinq/lore", null),
      mirrorOf(pool, "re-cinq/Lore", null),
    ]);

    expect({
      kbIds,
      created: setUpCalls().filter((call) => call.startsWith("POST")).length,
      saved: writesOf(pool).filter(Array.isArray).length,
    }).toEqual({ kbIds: ["kb-new", "kb-new"], created: 2, saved: 1 });
  });

  it("is null and calls Utopia for nothing on a deployment without UTOPIA_TOKEN", async () => {
    const kbId = await mirrorOf(makePool(), "re-cinq/lore", null, {
      ...autoEnv,
      UTOPIA_TOKEN: "",
    });

    expect({ kbId, calls: seen }).toEqual({ kbId: null, calls: [] });
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
      retried: "kb-new",
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

describe("knowledgeBaseToMirror on a base set up at ontology version 1", () => {
  it("re-imports the ontology into kb-1 once for two concurrent ingests, binds the seventeen kind words, stores version 7, and answers kb-1", async () => {
    const pool = makePool();
    const kbIds = await Promise.all([
      mirrorOf(pool, "re-cinq/lore", SETTINGS_V1),
      mirrorOf(pool, "re-cinq/Lore", SETTINGS_V1),
    ]);

    expect({
      kbIds,
      calls: setUpCalls(),
      bound: seen.length - setUpCalls().length,
      writes: writesOf(pool),
    }).toEqual({
      kbIds: ["kb-1", "kb-1"],
      calls: ["POST /api/v1/kbs/kb-1/ontology/imports Bearer utp_pat_lore"],
      bound: 17,
      writes: [SETTINGS],
    });
  });

  it("answers kb-1 and calls Utopia for nothing when the deployment has no UTOPIA_TOKEN, leaving version 1 stored", async () => {
    const pool = makePool();
    const kbId = await mirrorOf(pool, "re-cinq/lore", SETTINGS_V1, {
      ...autoEnv,
      UTOPIA_TOKEN: "",
    });

    expect({ kbId, calls: seen, writes: writesOf(pool) }).toEqual({
      kbId: "kb-1",
      calls: [],
      writes: [],
    });
  });

  it("answers kb-1 and counts one mirror failure for re-cinq/lore when Utopia refuses the import with 403, leaving version 1 stored", async () => {
    const pool = makePool();
    const before = (await mirrorFailures()).length;

    refusedPaths = ["/ontology/imports"];
    const kbId = await mirrorOf(pool, "re-cinq/lore", SETTINGS_V1);

    expect({
      kbId,
      writes: writesOf(pool),
      before,
      failures: await mirrorFailures(),
    }).toMatchObject({
      kbId: "kb-1",
      writes: [],
      before: 0,
      failures: [{ attributes: { repo: "re-cinq/lore" }, value: 1 }],
    });
  });
});

describe("knowledgeBaseToMirror on a base whose git-history and github sources still extract", () => {
  const poolHoldingSources = () => {
    const pool = makePool();

    pool.query.mockImplementation(async (sql: string, params: string[]) => {
      const isSourceRead = /FROM lore\.utopia_kind_sources/.test(sql);

      return {
        rows: isSourceRead
          ? [{ id: `src-${params[1]}`, key: "utp_k", kbId: "kb-1" }]
          : [],
      };
    });

    return pool;
  };

  it("patches src-git-history and src-github of kb-1 to extract false once for two concurrent ingests, then stores sources_extract_off", async () => {
    const pool = poolHoldingSources();

    await Promise.all([
      mirrorOf(pool, "re-cinq/lore", SETTINGS),
      mirrorOf(pool, "re-cinq/Lore", SETTINGS),
    ]);

    expect({ calls: seen.sort(), writes: writesOf(pool) }).toEqual({
      calls: [
        "PATCH /api/v1/kbs/kb-1/sources/src-git-history Bearer utp_pat_lore",
        "PATCH /api/v1/kbs/kb-1/sources/src-github Bearer utp_pat_lore",
      ],
      writes: [{ utopia: { kb_id: "kb-1", sources_extract_off: true } }],
    });
  });

  it("patches nothing when settings carry sources_extract_off true", async () => {
    const pool = poolHoldingSources();

    await mirrorOf(pool, "re-cinq/lore", {
      utopia: { ...SETTINGS.utopia, sources_extract_off: true },
    });

    expect(seen).toEqual([]);
  });

  it("answers kb-1, counts one mirror failure for re-cinq/lore and stores nothing when Utopia refuses the patch with 403", async () => {
    refusedPaths = ["/sources/src-github"];
    const pool = poolHoldingSources();
    const before = (await mirrorFailures()).at(0)?.value as number;
    const kbId = await mirrorOf(pool, "re-cinq/lore", SETTINGS);

    expect({
      kbId,
      writes: writesOf(pool),
      failures: ((await mirrorFailures()).at(0)?.value as number) - before,
    }).toEqual({ kbId: "kb-1", writes: [], failures: 1 });
  });
});
