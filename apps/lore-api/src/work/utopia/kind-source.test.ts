import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Pool } from "pg";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { makePool } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const SETTINGS = { utopia: { kb_id: "kb-1", ontology_version: 7 } };
let repoSettings: Record<string, unknown> = SETTINGS;

vi.mock("../../outbound/project-boot.js", () => ({
  projectFor: async () => ({
    settings: { rawSettings: async () => repoSettings },
  }),
}));

import { kindSourceOf, lazyKindDocumentDeps } from "./kind-source.js";

const seen: string[] = [];
const bodies: unknown[] = [];
let server: Server;
let env: Record<string, string>;

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let body = "";

    req.on("data", (chunk) => (body += String(chunk)));
    req.on("end", () => resolve(body));
  });

beforeAll(async () => {
  server = createServer(async (req, res) => {
    seen.push(`${req.method} ${req.url} ${req.headers.authorization}`);
    bodies.push(JSON.parse(await readBody(req)));
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({ ingest_token: "utp_new", source: { id: "src-new" } }),
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();

  enforceTrue(
    !(addr === null || typeof addr === "string"),
    Error,
    "no server address",
  );
  env = {
    UTOPIA_API_URL: `http://127.0.0.1:${addr.port}`,
    UTOPIA_TOKEN: "utp_pat_lore",
    UTOPIA_WORKSPACE_ID: "ws-lore",
  };
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

beforeEach(() => {
  repoSettings = SETTINGS;
  seen.length = 0;
  bodies.length = 0;
});

interface Held {
  kindSources?: { kind: string; kbId: string; id: string; key: string }[];
}

function poolHolding(held: Held) {
  const pool = makePool();

  pool.query.mockImplementation(async (sql: string, params: string[]) => {
    if (/FROM lore\.utopia_kind_sources/.test(sql)) {
      return {
        rows: (held.kindSources ?? []).filter(({ kind }) => kind === params[1]),
      };
    }

    return { rows: [] };
  });

  return pool;
}

const asPool = (pool: ReturnType<typeof makePool>) => pool as unknown as Pool;

const kindSourceWrites = (pool: ReturnType<typeof makePool>) =>
  pool.query.mock.calls
    .filter(([sql]) => /INSERT INTO lore\.utopia_kind_sources/.test(sql))
    .map(([, params]) => params);

const STORED_DOCS = {
  kind: "docs",
  kbId: "kb-1",
  id: "src-docs",
  key: "utp_d",
};

describe("kindSourceOf", () => {
  it("answers the stored src-docs under utp_d and calls Utopia for nothing when re-cinq/lore holds a docs source in kb-1", async () => {
    const pool = poolHolding({ kindSources: [STORED_DOCS] });

    const source = await kindSourceOf(
      asPool(pool),
      "re-cinq/lore",
      "docs",
      env,
    );

    expect({ source, seen }).toEqual({
      source: { id: "src-docs", key: "utp_d" },
      seen: [],
    });
  });

  it("creates the api source docs in kb-1 under utp_pat_lore, stores src-new with its key, and answers it when re-cinq/lore has no docs source", async () => {
    const pool = poolHolding({});

    const source = await kindSourceOf(
      asPool(pool),
      "re-cinq/lore",
      "docs",
      env,
    );

    expect({
      source,
      seen,
      created: bodies,
      writes: kindSourceWrites(pool),
    }).toEqual({
      source: { id: "src-new", key: "utp_new" },
      seen: ["POST /api/v1/kbs/kb-1/sources Bearer utp_pat_lore"],
      created: [{ kind: "api", name: "docs", config: {} }],
      writes: [["re-cinq/lore", "docs", "kb-1", "src-new", "utp_new"]],
    });
  });

  it("creates the api sources git-history and github by those names with the config extract false", async () => {
    const pool = poolHolding({});

    await kindSourceOf(asPool(pool), "re-cinq/lore", "git-history", env);
    await kindSourceOf(asPool(pool), "re-cinq/lore", "github", env);

    expect(bodies).toEqual([
      { kind: "api", name: "git-history", config: { extract: false } },
      { kind: "api", name: "github", config: { extract: false } },
    ]);
  });

  it("creates test-coverage as a statements source, not an api one", async () => {
    const pool = poolHolding({});

    await kindSourceOf(asPool(pool), "re-cinq/lore", "test-coverage", env);

    expect(bodies).toEqual([
      { kind: "statements", name: "test-coverage", config: {} },
    ]);
  });

  it("creates a new docs source when the stored one belongs to knowledge base kb-0", async () => {
    const pool = poolHolding({
      kindSources: [{ ...STORED_DOCS, kbId: "kb-0" }],
    });

    const source = await kindSourceOf(
      asPool(pool),
      "re-cinq/lore",
      "docs",
      env,
    );

    expect(source).toEqual({ id: "src-new", key: "utp_new" });
  });

  it("shares one creation between two concurrent pushes to re-cinq/lore's docs: one POST, one stored row", async () => {
    const pool = poolHolding({});

    await Promise.all([
      kindSourceOf(asPool(pool), "re-cinq/lore", "docs", env),
      kindSourceOf(asPool(pool), "re-cinq/lore", "docs", env),
    ]);

    expect({
      posts: seen.length,
      writes: kindSourceWrites(pool).length,
    }).toEqual({ posts: 1, writes: 1 });
  });

  it("rejects naming re-cinq/lore and docs, and writes nothing, when the deployment has no UTOPIA_TOKEN to create one", async () => {
    const pool = poolHolding({});

    await expect(
      kindSourceOf(asPool(pool), "re-cinq/lore", "docs", {
        UTOPIA_API_URL: env.UTOPIA_API_URL,
      }),
    ).rejects.toThrow(
      new Error(
        "re-cinq/lore has no Utopia docs source and this deployment cannot create one",
      ),
    );
    expect(kindSourceWrites(pool)).toEqual([]);
  });

  it("rejects naming re-cinq/lore when it has no Utopia knowledge base and the deployment cannot set one up", async () => {
    const pool = poolHolding({});

    repoSettings = {};

    await expect(
      kindSourceOf(asPool(pool), "re-cinq/lore", "docs", {
        UTOPIA_API_URL: env.UTOPIA_API_URL,
      }),
    ).rejects.toThrow(
      new Error(
        "re-cinq/lore has no Utopia knowledge base and this deployment cannot set one up",
      ),
    );
  });
});

describe("lazyKindDocumentDeps", () => {
  it("calls Utopia and stores nothing until its first push", () => {
    const pool = poolHolding({});

    lazyKindDocumentDeps(asPool(pool), "re-cinq/lore", "git-history", env);

    expect({ seen, writes: kindSourceWrites(pool) }).toEqual({
      seen: [],
      writes: [],
    });
  });

  it("creates the git-history api source once and posts both documents to it under its key", async () => {
    const pool = poolHolding({});
    const deps = lazyKindDocumentDeps(
      asPool(pool),
      "re-cinq/lore",
      "git-history",
      env,
    );

    await deps.push({ external_id: "commit:a", filename: "commit-a" });
    await deps.push({ external_id: "commit:b", filename: "commit-b" });

    expect(seen).toEqual([
      "POST /api/v1/kbs/kb-1/sources Bearer utp_pat_lore",
      "POST /api/v1/sources/src-new/ingest Bearer utp_new",
      "POST /api/v1/sources/src-new/ingest Bearer utp_new",
    ]);
  });
});

describe("kindSourceOf settings", () => {
  const settingWrites = (pool: ReturnType<typeof makePool>) =>
    pool.query.mock.calls
      .filter(([sql]) => /jsonb_set/.test(sql))
      .map(([, params]) => params);

  it("records src-new as re-cinq/lore's docs_source_id when it creates the docs source", async () => {
    const pool = poolHolding({});

    await kindSourceOf(asPool(pool), "re-cinq/lore", "docs", env);

    expect(settingWrites(pool)).toEqual([
      ["src-new", "re-cinq/lore", "docs_source_id"],
    ]);
  });

  it("records no setting when it creates the git-history source or answers a stored docs source", async () => {
    const pool = poolHolding({ kindSources: [STORED_DOCS] });

    await kindSourceOf(asPool(pool), "re-cinq/lore", "git-history", env);
    await kindSourceOf(asPool(pool), "re-cinq/lore", "docs", env);

    expect(settingWrites(pool)).toEqual([]);
  });
});
