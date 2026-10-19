import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { createServer, type Server } from "node:http";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";

const SETTINGS = {
  utopia: { kb_id: "kb-1", source_id: "src-1", ontology_version: 6 },
};

vi.mock("../../../outbound/project-boot.js", () => ({
  projectFor: async () => ({
    repo: {},
    settings: { rawSettings: async () => SETTINGS },
  }),
}));

import { buildServer } from "../../../app/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };
const pushes: string[] = [];
let server: Server;

beforeAll(async () => {
  server = createServer((req, res) => {
    pushes.push(`${req.method} ${req.url} ${req.headers.authorization}`);
    req.resume();
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ action: "created" }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();

  enforceTrue(
    !(addr === null || typeof addr === "string"),
    Error,
    "no server address",
  );
  process.env.UTOPIA_API_URL = `http://127.0.0.1:${addr.port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

const MEMORY_ROW = {
  id: "m-42",
  agent_id: "claude-bogdan",
  key: "gotchas",
  value: "Open node-local-dns.",
  repo: "re-cinq/lore",
  created_at: "2026-10-19T08:30:00+00:00",
  live: true,
};

const STORED_SRC_1 = { kb_id: "kb-1", source_id: "src-1", source_key: "utp_k" };
const STORED_SRC_MEM = {
  kbId: "kb-1",
  id: "src-mem",
  key: "utp_mem",
  cursor: "m-41",
};

function poolHolding(held: { repoSource: boolean; memorySource: boolean }) {
  const pool = makePool();
  const cursorWrites: unknown[][] = [];
  const answers: [RegExp, () => unknown[]][] = [
    [/FROM memory\.memories/, () => [MEMORY_ROW]],
    [/FROM memory\.episodes/, () => []],
    [/FROM lore\.repos/, () => [{ full_name: "re-cinq/lore" }]],
    [
      /FROM lore\.utopia_sources/,
      () => (held.repoSource ? [STORED_SRC_1] : []),
    ],
    [
      /FROM lore\.utopia_memory_sources/,
      () => (held.memorySource ? [STORED_SRC_MEM] : []),
    ],
  ];

  pool.query.mockImplementation(async (sql: string, params: unknown[]) => {
    if (/UPDATE lore\.utopia_memory_sources/.test(sql)) {
      cursorWrites.push(params);
    }

    return { rows: answers.find(([table]) => table.test(sql))?.[1]() ?? [] };
  });

  return { pool, cursorWrites };
}

const post = (pool: unknown, url: string) =>
  buildServer(() => pool as never).inject({
    method: "POST",
    url,
    headers: AUTH,
  });

describe("POST /api/repos/{owner}/{repo}/utopia/memory", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    pushes.length = 0;
  });
  afterEach(() => {
    process.env = {
      ...originalEnv,
      UTOPIA_API_URL: process.env.UTOPIA_API_URL,
    };
  });

  it("pushes memory m-42 after cursor m-41 through the stored src-mem key, moves the cursor to m-42, completes the pass and answers both walks", async () => {
    const { pool, cursorWrites } = poolHolding({
      repoSource: true,
      memorySource: true,
    });
    const res = await post(pool, "/api/repos/re-cinq/lore/utopia/memory");

    expect({
      status: res.statusCode,
      body: res.result,
      pushes,
      cursorWrites,
    }).toEqual({
      status: 200,
      body: {
        memories: {
          from: "m-41",
          to: "m-42",
          entries: 1,
          created: 1,
          updated: 0,
          unchanged: 0,
          failed: [],
          pass_complete: true,
        },
        episodes: {
          from: "m-41",
          to: null,
          entries: 0,
          created: 0,
          updated: 0,
          unchanged: 0,
          failed: [],
        },
      },
      pushes: ["POST /api/v1/sources/src-mem/ingest Bearer utp_mem"],
      cursorWrites: [
        ["re-cinq/lore", "memories", "m-42"],
        ["re-cinq/lore", "memories", null],
      ],
    });
  });

  it("answers 409 utopia_not_set_up and pushes nothing when re-cinq/lore has no stored source and UTOPIA_TOKEN is unset", async () => {
    const { pool } = poolHolding({ repoSource: false, memorySource: false });
    const res = await post(pool, "/api/repos/re-cinq/lore/utopia/memory");

    expect({ status: res.statusCode, pushes }).toEqual({
      status: 409,
      pushes: [],
    });
  });
});

describe("POST /api/utopia/memory", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    pushes.length = 0;
  });
  afterEach(() => {
    process.env = {
      ...originalEnv,
      UTOPIA_API_URL: process.env.UTOPIA_API_URL,
    };
  });

  it("answers 409 utopia_org_not_named when GITHUB_ORG is unset", async () => {
    delete process.env.GITHUB_ORG;
    const { pool } = poolHolding({ repoSource: true, memorySource: true });
    const res = await post(pool, "/api/utopia/memory");

    expect({ status: res.statusCode, pushes }).toEqual({
      status: 409,
      pushes: [],
    });
  });

  it("walks the rows of re-cinq/memory when GITHUB_ORG is re-cinq and pushes them through its stored src-mem key", async () => {
    process.env.GITHUB_ORG = "re-cinq";
    const { pool } = poolHolding({ repoSource: true, memorySource: true });
    const res = await post(pool, "/api/utopia/memory");

    expect({ status: res.statusCode, pushes }).toEqual({
      status: 200,
      pushes: ["POST /api/v1/sources/src-mem/ingest Bearer utp_mem"],
    });
  });

  it("answers 503 when UTOPIA_API_URL is unset", async () => {
    delete process.env.UTOPIA_API_URL;
    process.env.GITHUB_ORG = "re-cinq";
    const { pool } = poolHolding({ repoSource: true, memorySource: true });

    expect((await post(pool, "/api/utopia/memory")).statusCode).toBe(503);
  });
});
