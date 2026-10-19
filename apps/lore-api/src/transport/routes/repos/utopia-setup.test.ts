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
  "POST /api/v1/kbs/kb-1/sources": {
    ingest_token: "utp_fresh",
    source: { id: "src-fresh" },
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

interface StoredSource {
  kb_id: string;
  source_id: string;
  source_key: string;
}

const poolWith = (
  settings: Record<string, unknown> | null,
  stored: StoredSource | null = null,
) => {
  const pool = makePool();

  pool.query.mockImplementation(async (sql: string) => {
    if (/FROM lore\.repos/.test(sql)) {
      return { rows: [{ settings }] };
    }

    return {
      rows: /FROM lore\.utopia_sources/.test(sql) && stored ? [stored] : [],
    };
  });

  return pool;
};

const setup = (pool: unknown, workspaceId: string) =>
  buildServer(() => pool as never).inject({
    method: "POST",
    url: "/api/repos/re-cinq/lore/utopia/setup",
    headers: AUTH,
    payload: { session_token: "jwt-1", workspace_id: workspaceId },
  });

const paramsOf = (pool: ReturnType<typeof makePool>, statement: RegExp) =>
  pool.query.mock.calls
    .filter(([sql]) => statement.test(String(sql)))
    .map(([, params]) => params as string[]);

const writtenSettings = (pool: ReturnType<typeof makePool>) =>
  paramsOf(pool, /UPDATE lore\.repos/).map(([json]) => ({
    utopia: JSON.parse(json),
  }));

const savedSources = (pool: ReturnType<typeof makePool>) =>
  paramsOf(pool, /INSERT INTO lore\.utopia_sources/);

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

  it("creates the knowledge base, imports the ontology, binds the sixteen kind words, creates the lore source, saves its key to lore.utopia_sources and its ids to settings", async () => {
    const pool = poolWith({ auto_review: true });
    const res = await setup(pool, "ws-1");

    expect({
      status: res.statusCode,
      body: res.result,
      calls: seen.filter((call) => !call.startsWith("bind ")),
      bound: seen.filter((call) => call.startsWith("bind ")).length,
      statementBound: seen.includes('bind Statement {"class":"statement"}'),
      written: writtenSettings(pool),
      saved: savedSources(pool),
    }).toEqual({
      status: 200,
      body: { kb_id: "kb-new", source_id: "src-new", ontology_version: 6 },
      calls: [
        "GET /api/v1/workspaces/ws-1/kbs",
        "POST /api/v1/workspaces/ws-1/kbs",
        "POST /api/v1/kbs/kb-new/ontology/imports",
        "POST /api/v1/kbs/kb-new/sources",
      ],
      bound: 16,
      statementBound: true,
      written: [
        {
          utopia: {
            kb_id: "kb-new",
            source_id: "src-new",
            ontology_version: 6,
          },
        },
      ],
      saved: [["re-cinq/lore", "kb-new", "src-new", "utp_new"]],
    });
  });

  it("leaves no source_key and no utp_ key anywhere in the settings it writes", async () => {
    const pool = poolWith({ auto_review: true });

    await setup(pool, "ws-1");
    const written = JSON.stringify(paramsOf(pool, /lore\.repos/));

    expect({
      sourceKey: written.includes("source_key"),
      key: written.includes("utp_"),
    }).toEqual({ sourceKey: false, key: false });
  });

  it("keeps the source whose key lore.utopia_sources holds for the knowledge base it finds by name", async () => {
    const pool = poolWith(
      { utopia: { kb_id: "kb-1", source_id: "src-old" } },
      { kb_id: "kb-1", source_id: "src-old", source_key: "utp_old" },
    );
    const res = await setup(pool, "ws-2");

    expect({
      body: res.result,
      sourcesCreated: seen.filter((call) => call.endsWith("/sources")).length,
      saved: savedSources(pool),
    }).toEqual({
      body: { kb_id: "kb-1", source_id: "src-old", ontology_version: 6 },
      sourcesCreated: 0,
      saved: [["re-cinq/lore", "kb-1", "src-old", "utp_old"]],
    });
  });

  it("creates src-fresh when settings name src-old but lore.utopia_sources holds no key for it", async () => {
    const pool = poolWith({ utopia: { kb_id: "kb-1", source_id: "src-old" } });
    const res = await setup(pool, "ws-2");

    expect({ body: res.result, saved: savedSources(pool) }).toEqual({
      body: { kb_id: "kb-1", source_id: "src-fresh", ontology_version: 6 },
      saved: [["re-cinq/lore", "kb-1", "src-fresh", "utp_fresh"]],
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
    const res = await setup(poolWith({}), "ws-1");

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
