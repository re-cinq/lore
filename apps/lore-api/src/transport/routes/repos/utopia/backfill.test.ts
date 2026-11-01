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

const SETTINGS = { utopia: { kb_id: "kb-1" } };
const TREE = ["specs/a/spec.md", "adrs/ADR-001-auth.md", "src/index.ts"];
const githubReads: string[] = [];

const fakeFiles = {
  defaultBranch: async () => "main",
  headSha: async (branch: string) => `${branch}-head`,
  tree: async (ref: string) => {
    githubReads.push(`tree ${ref}`);

    return TREE;
  },
  read: async (path: string, ref: string) =>
    path.endsWith(".md") ? `# ${path}\n\nRead at ${ref}.\n` : null,
  branchHistory: async () => [],
  trackerActivity: async () => [],
  tags: async () => [],
  releases: async () => [],
};
let repoSettings: Record<string, unknown> = SETTINGS;

vi.mock("../../../../outbound/project-boot.js", () => ({
  projectFor: async () => ({
    repo: fakeFiles,
    settings: { rawSettings: async () => repoSettings },
  }),
}));

import { buildServer } from "../../../../app/build-server.js";
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

const poolHolding = () => {
  const pool = makePool();

  pool.query.mockImplementation(async (sql: string, params: string[]) => {
    if (/FROM (memory\.|lore\.utopia_memory_sources)/.test(sql)) {
      return { rows: [] };
    }

    if (/FROM lore\.utopia_kind_sources/.test(sql)) {
      return {
        rows: [
          { id: `src-${params[1]}`, key: `utp_${params[1]}`, kbId: "kb-1" },
        ],
      };
    }

    return {
      rows: /FROM lore\.repos/.test(sql) ? [{ full_name: "re-cinq/lore" }] : [],
    };
  });

  return pool;
};

const backfill = (pool: unknown) =>
  buildServer(() => pool as never).inject({
    method: "POST",
    url: "/api/repos/re-cinq/lore/utopia/backfill",
    headers: AUTH,
  });

const NOTHING_WALKED = {
  from: null,
  to: null,
  entries: 0,
  created: 0,
  updated: 0,
  unchanged: 0,
  failed: [],
};

describe("POST /api/repos/{owner}/{repo}/utopia/backfill", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    repoSettings = SETTINGS;
    pushes.length = 0;
    githubReads.length = 0;
  });
  afterEach(() => {
    process.env = {
      ...originalEnv,
      UTOPIA_API_URL: process.env.UTOPIA_API_URL,
    };
  });

  it("mirrors the spec and the ADR at main-head, each as a text document in the docs source and a statement in the test-coverage source, and answers 2 documents and 4 created items", async () => {
    const res = await backfill(poolHolding());

    expect({
      status: res.statusCode,
      body: res.result,
      pushes: [...pushes].sort(),
    }).toEqual({
      status: 200,
      body: {
        commit: "main-head",
        documents: 2,
        created: 4,
        updated: 0,
        unchanged: 0,
        failed: [],
        commits: {
          branch: "main",
          from: null,
          to: null,
          commits: 0,
          created: 0,
          updated: 0,
          unchanged: 0,
          failed: [],
        },
        tracker: {
          from: null,
          to: null,
          entries: 0,
          created: 0,
          updated: 0,
          unchanged: 0,
          failed: [],
        },
        releases: {
          tags: 0,
          releases: 0,
          created: 0,
          updated: 0,
          unchanged: 0,
          failed: [],
        },
        memory: {
          memories: { ...NOTHING_WALKED, pass_complete: true },
          episodes: NOTHING_WALKED,
        },
      },
      pushes: [
        "POST /api/v1/sources/src-docs/ingest Bearer utp_docs",
        "POST /api/v1/sources/src-docs/ingest Bearer utp_docs",
        "POST /api/v1/sources/src-test-coverage/statements Bearer utp_test-coverage",
        "POST /api/v1/sources/src-test-coverage/statements Bearer utp_test-coverage",
      ],
    });
  });

  it("answers 409 utopia_not_set_up and reads nothing from GitHub when re-cinq/lore has no Utopia knowledge base and UTOPIA_TOKEN is unset", async () => {
    repoSettings = {};
    const res = await backfill(poolHolding());

    expect({
      status: res.statusCode,
      code: (res.result as { code?: string }).code,
      reads: githubReads,
      pushes,
    }).toEqual({
      status: 409,
      code: "utopia_not_set_up",
      reads: [],
      pushes: [],
    });
  });

  it("answers 404 for a repo Lore does not hold", async () => {
    const res = await backfill(makePool());

    expect(res.statusCode).toBe(404);
  });

  it("answers 503 when UTOPIA_API_URL is unset", async () => {
    delete process.env.UTOPIA_API_URL;
    const res = await backfill(poolHolding());

    expect(res.statusCode).toBe(503);
  });
});
