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
const githubReads: string[] = [];

const fakeFiles = {
  tags: async () => {
    githubReads.push("tags");

    return [{ name: "v1.2.0", sha: "abc123" }];
  },
  releases: async () => {
    githubReads.push("releases");

    return [
      {
        tag: "v1.2.0",
        name: "Lore 1.2",
        body: "",
        author: "gedaiu",
        publishedAt: "2026-10-17T09:00:00Z",
      },
    ];
  },
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

const releases = (pool: unknown) =>
  buildServer(() => pool as never).inject({
    method: "POST",
    url: "/api/repos/re-cinq/lore/utopia/releases",
    headers: AUTH,
  });

describe("POST /api/repos/{owner}/{repo}/utopia/releases", () => {
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

  it("pushes the tag v1.2.0 and its release as text to the github source and answers one of each", async () => {
    const res = await releases(poolHolding());

    expect({
      status: res.statusCode,
      body: res.result,
      pushes,
      githubReads: [...githubReads].sort(),
      cursorWrites: cursorWrites.length,
    }).toEqual({
      status: 200,
      body: {
        tags: 1,
        releases: 1,
        created: 2,
        updated: 0,
        unchanged: 0,
        failed: [],
      },
      pushes: Array(2).fill(
        "POST /api/v1/sources/src-github/ingest Bearer utp_github",
      ),
      githubReads: ["releases", "tags"],
      cursorWrites: 0,
    });
  });

  it("answers 409 utopia_not_set_up and reads nothing from GitHub when re-cinq/lore has no Utopia knowledge base and UTOPIA_TOKEN is unset", async () => {
    repoSettings = {};
    const res = await releases(poolHolding());

    expect({ status: res.statusCode, githubReads }).toEqual({
      status: 409,
      githubReads: [],
    });
  });

  it("answers 503 when UTOPIA_API_URL is unset", async () => {
    delete process.env.UTOPIA_API_URL;

    expect((await releases(poolHolding())).statusCode).toBe(503);
  });
});
