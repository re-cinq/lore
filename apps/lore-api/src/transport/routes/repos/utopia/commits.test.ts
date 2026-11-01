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
  utopia: { kb_id: "kb-1", commits_head: "c0" },
};
let repoSettings: Record<string, unknown> = SETTINGS;
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
  branchHistory: async (branch: string, opts: { until?: string }) => {
    githubReads.push(`history ${branch} above ${opts.until ?? "root"}`);

    return [
      {
        sha: "c1",
        parents: [],
        subject: "First (#1)",
        body: "Closes #2",
        author: "Szabo Bogdan",
        authoredAt: "2026-10-16T08:00:00Z",
      },
    ];
  },
};

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
const cursorWrites: string[] = [];
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
    if (/jsonb_set/.test(sql)) {
      cursorWrites.push(sql);
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

const commits = (pool: unknown, payload?: Record<string, unknown>) =>
  buildServer(() => pool as never).inject({
    method: "POST",
    url: "/api/repos/re-cinq/lore/utopia/commits",
    headers: AUTH,
    ...(payload ? { payload } : {}),
  });

describe("POST /api/repos/{owner}/{repo}/utopia/commits", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    repoSettings = SETTINGS;
    pushes.length = 0;
    githubReads.length = 0;
    cursorWrites.length = 0;
  });
  afterEach(() => {
    process.env = {
      ...originalEnv,
      UTOPIA_API_URL: process.env.UTOPIA_API_URL,
    };
  });

  it("walks main above the stored cursor c0, pushes commit c1 as text to the git-history source, moves the cursor to c1 and answers the walk", async () => {
    const res = await commits(poolHolding());

    expect({
      status: res.statusCode,
      body: res.result,
      pushes,
      githubReads,
      cursorWrites: cursorWrites.length,
    }).toEqual({
      status: 200,
      body: {
        branch: "main",
        from: "c0",
        to: "c1",
        commits: 1,
        created: 1,
        updated: 0,
        unchanged: 0,
        failed: [],
      },
      pushes: [
        "POST /api/v1/sources/src-git-history/ingest Bearer utp_git-history",
      ],
      githubReads: ["history main above c0"],
      cursorWrites: 1,
    });
  });

  it("skips a push to feat/x, reading nothing from GitHub, since Utopia holds the default branch's history alone", async () => {
    const res = await commits(poolHolding(), { branch: "feat/x" });

    expect({ status: res.statusCode, body: res.result, githubReads }).toEqual({
      status: 200,
      body: {
        branch: "feat/x",
        from: null,
        to: null,
        commits: 0,
        created: 0,
        updated: 0,
        unchanged: 0,
        failed: [],
        skipped: "not the default branch",
      },
      githubReads: [],
    });
  });

  it("answers 409 utopia_not_set_up and reads nothing from GitHub when re-cinq/lore has no Utopia knowledge base and UTOPIA_TOKEN is unset", async () => {
    repoSettings = {};
    const res = await commits(poolHolding());

    expect({ status: res.statusCode, githubReads }).toEqual({
      status: 409,
      githubReads: [],
    });
  });

  it("answers 503 when UTOPIA_API_URL is unset", async () => {
    delete process.env.UTOPIA_API_URL;

    expect((await commits(poolHolding())).statusCode).toBe(503);
  });
});
