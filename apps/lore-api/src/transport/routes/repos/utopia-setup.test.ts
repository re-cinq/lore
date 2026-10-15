import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { buildServer } from "../../../app/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };
const seen: string[] = [];
let server: Server;

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let body = "";

    req.on("data", (chunk) => (body += String(chunk)));
    req.on("end", () => resolve(body));
  });

const ANSWERS: Record<string, unknown> = {
  "GET /api/v1/workspaces/ws-1/kbs": [
    { id: "kb-other", name: "re-cinq/floor" },
  ],
  "POST /api/v1/workspaces/ws-1/kbs": { id: "kb-new", name: "re-cinq/lore" },
  "GET /api/v1/workspaces/ws-2/kbs": [{ id: "kb-1", name: "re-cinq/lore" }],
  "POST /api/v1/kbs/kb-new/ontology/imports": { import_id: "imp-1", plan: {} },
  "POST /api/v1/kbs/kb-1/ontology/imports": { import_id: "imp-2", plan: {} },
  "POST /api/v1/kbs/kb-new/sources": {
    ingest_token: "utp_new",
    source: { id: "src-new" },
  },
};

const answerOf = (
  req: IncomingMessage,
  body: string,
): { call: string; status: number; payload: unknown } => {
  const key = `${req.method} ${req.url}`;
  const bound = /\/kind-words\/(\w+)$/.exec(req.url ?? "");

  if (bound) {
    return {
      call: `bind ${bound[1]} ${body}`,
      status: 200,
      payload: { ok: true },
    };
  }

  return {
    call: key,
    status: key in ANSWERS ? 200 : 404,
    payload: ANSWERS[key] ?? {},
  };
};

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const { call, status, payload } = answerOf(req, await readBody(req));

    seen.push(call);
    res.setHeader("content-type", "application/json");
    res.statusCode = status;
    res.end(JSON.stringify(payload));
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

const poolWithSettings = (settings: Record<string, unknown> | null) => {
  const pool = makePool();

  pool.query.mockImplementation(async (sql: string) =>
    /SELECT settings/.test(sql) ? { rows: [{ settings }] } : { rows: [] },
  );

  return pool;
};

const setup = (pool: unknown, workspaceId: string) =>
  buildServer(() => pool as never).inject({
    method: "POST",
    url: "/api/repos/re-cinq/lore/utopia/setup",
    headers: AUTH,
    payload: { session_token: "jwt-1", workspace_id: workspaceId },
  });

const writtenSettings = (pool: ReturnType<typeof makePool>) =>
  pool.query.mock.calls
    .filter(([sql]) => /UPDATE lore\.repos/.test(String(sql)))
    .map(([, params]) => JSON.parse((params as string[])[0]));

describe("POST /api/repos/{owner}/{repo}/utopia/setup", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    seen.length = 0;
  });
  afterEach(() => {
    process.env = {
      ...originalEnv,
      UTOPIA_API_URL: process.env.UTOPIA_API_URL,
    };
  });

  it("creates the knowledge base, imports the ontology, binds the ten kind words, creates the lore source and stores the block with its key", async () => {
    const pool = poolWithSettings({ auto_review: true });
    const res = await setup(pool, "ws-1");

    expect({
      status: res.statusCode,
      body: res.result,
      calls: seen.filter((call) => !call.startsWith("bind ")),
      bound: seen.filter((call) => call.startsWith("bind ")).length,
      statementBound: seen.includes('bind Statement {"class":"statement"}'),
      written: writtenSettings(pool),
    }).toEqual({
      status: 200,
      body: { kb_id: "kb-new", source_id: "src-new", ontology_version: 1 },
      calls: [
        "GET /api/v1/workspaces/ws-1/kbs",
        "POST /api/v1/workspaces/ws-1/kbs",
        "POST /api/v1/kbs/kb-new/ontology/imports",
        "POST /api/v1/kbs/kb-new/sources",
      ],
      bound: 10,
      statementBound: true,
      written: [
        {
          utopia: {
            kb_id: "kb-new",
            source_id: "src-new",
            source_key: "utp_new",
            ontology_version: 1,
          },
        },
      ],
    });
  });

  it("keeps the source and key already in settings for the knowledge base it finds by name", async () => {
    const pool = poolWithSettings({
      utopia: { kb_id: "kb-1", source_id: "src-old", source_key: "utp_old" },
    });
    const res = await setup(pool, "ws-2");

    expect({
      body: res.result,
      sourcesCreated: seen.filter((call) => call.endsWith("/sources")).length,
      written: writtenSettings(pool),
    }).toEqual({
      body: { kb_id: "kb-1", source_id: "src-old", ontology_version: 1 },
      sourcesCreated: 0,
      written: [
        {
          utopia: {
            kb_id: "kb-1",
            source_id: "src-old",
            source_key: "utp_old",
            ontology_version: 1,
          },
        },
      ],
    });
  });

  it("answers 404 for a repo Lore does not hold and calls Utopia for nothing", async () => {
    const res = await setup(makePool(), "ws-1");

    expect({ status: res.statusCode, calls: seen }).toEqual({
      status: 404,
      calls: [],
    });
  });

  it("answers 503 when UTOPIA_API_URL is unset", async () => {
    delete process.env.UTOPIA_API_URL;
    const res = await setup(poolWithSettings({}), "ws-1");

    expect(res.statusCode).toBe(503);
  });

  it("answers 400 without a session token", async () => {
    const res = await buildServer(() => makePool() as never).inject({
      method: "POST",
      url: "/api/repos/re-cinq/lore/utopia/setup",
      headers: AUTH,
      payload: { workspace_id: "ws-1" },
    });

    expect(res.statusCode).toBe(400);
  });
});
