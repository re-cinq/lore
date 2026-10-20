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

vi.mock("../../outbound/project-boot.js", () => ({
  projectFor: async () => ({
    settings: {
      rawSettings: async () => ({
        utopia: { kb_id: "kb-1", source_id: "src-1", ontology_version: 7 },
      }),
    },
  }),
}));

import { mirrorEpisode, mirrorMemory } from "./utopia-memory-push.js";

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

const ANSWERS: Record<string, unknown> = {
  "POST /api/v1/kbs/kb-1/sources": {
    ingest_token: "utp_new",
    source: { id: "src-new" },
  },
};

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const key = `${req.method} ${req.url}`;

    seen.push(`${key} ${req.headers.authorization}`);
    bodies.push(JSON.parse(await readBody(req)));
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(ANSWERS[key] ?? { action: "created" }));
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
    GITHUB_ORG: "re-cinq",
  };
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

beforeEach(() => {
  seen.length = 0;
  bodies.length = 0;
});

const MEMORY_ROW = {
  id: "m-9",
  agent_id: "claude-bogdan",
  key: "gotchas",
  value: "Open node-local-dns.",
  repo: "re-cinq/lore",
  created_at: "2026-10-19T08:30:00+00:00",
  live: true,
};

const MEMORIES_SOURCE = {
  kbId: "kb-1",
  id: "src-mem",
  key: "utp_mem",
  cursor: null,
};

interface Held {
  onboarded?: string[];
  memories?: (typeof MEMORY_ROW)[];
  repoSources?: Record<string, { kb_id: string; source_id: string }>;
  memorySources?: (typeof MEMORIES_SOURCE)[];
}

type Answer = (params: string[]) => unknown[];

function poolHolding(held: Held) {
  const pool = makePool();
  const answers: [RegExp, Answer][] = [
    [/FROM memory\.memories/, () => held.memories ?? []],
    [/FROM lore\.utopia_memory_sources/, () => held.memorySources ?? []],
    [
      /FROM lore\.utopia_sources/,
      ([repo]) => {
        const stored = held.repoSources?.[repo];

        return stored ? [{ ...stored, source_key: "utp_k" }] : [];
      },
    ],
    [
      /FROM lore\.repos/,
      ([repo]) =>
        (held.onboarded ?? [])
          .filter((name) => name.toLowerCase() === repo.toLowerCase())
          .map((full_name) => ({ full_name })),
    ],
  ];

  pool.query.mockImplementation(async (sql: string, params: string[]) => ({
    rows: answers.find(([table]) => table.test(sql))?.[1](params) ?? [],
  }));

  return pool;
}

const asPool = (pool: ReturnType<typeof makePool>) => pool as unknown as Pool;

const memorySourceWrites = (pool: ReturnType<typeof makePool>) =>
  pool.query.mock.calls
    .filter(([sql]) => /INSERT INTO lore\.utopia_memory_sources/.test(sql))
    .map(([, params]) => params);

const LORE_SRC_1 = { "re-cinq/lore": { kb_id: "kb-1", source_id: "src-1" } };

describe("mirrorMemory", () => {
  it("pushes memory:claude-bogdan/gotchas of re-cinq/lore to the base's memories source src-mem under its key", async () => {
    const pool = poolHolding({
      onboarded: ["re-cinq/lore"],
      memories: [MEMORY_ROW],
      repoSources: LORE_SRC_1,
      memorySources: [MEMORIES_SOURCE],
    });

    await mirrorMemory(
      asPool(pool),
      { key: "gotchas", agentId: "claude-bogdan", repo: "re-cinq/lore" },
      env,
    );

    expect({ seen, bodies }).toEqual({
      seen: [`POST /api/v1/sources/src-mem/ingest Bearer utp_mem`],
      bodies: [
        {
          external_id: "memory:claude-bogdan/gotchas",
          filename: "gotchas",
          content: "gotchas\n\nOpen node-local-dns.",
          doc_time: "2026-10-19T08:30:00+00:00",
        },
      ],
    });
  });

  it("creates the api source memories in kb-1 under utp_pat_lore, stores src-new with its key, and pushes through it when re-cinq/lore has none yet", async () => {
    const pool = poolHolding({
      onboarded: ["re-cinq/lore"],
      memories: [MEMORY_ROW],
      repoSources: LORE_SRC_1,
    });

    await mirrorMemory(
      asPool(pool),
      { key: "gotchas", agentId: "claude-bogdan", repo: "re-cinq/lore" },
      env,
    );

    expect({
      seen,
      created: bodies[0],
      writes: memorySourceWrites(pool),
    }).toEqual({
      seen: [
        "POST /api/v1/kbs/kb-1/sources Bearer utp_pat_lore",
        "POST /api/v1/sources/src-new/ingest Bearer utp_new",
      ],
      created: { kind: "api", name: "memories", config: {} },
      writes: [["re-cinq/lore", "memories", "kb-1", "src-new", "utp_new"]],
    });
  });

  it("pushes a memory whose repo Lore does not hold to the org base re-cinq/memory", async () => {
    const pool = poolHolding({
      memories: [{ ...MEMORY_ROW, repo: "someone/else" }],
      repoSources: { "re-cinq/memory": { kb_id: "kb-1", source_id: "src-o" } },
      memorySources: [MEMORIES_SOURCE],
    });

    await mirrorMemory(
      asPool(pool),
      { key: "gotchas", agentId: "claude-bogdan", repo: "someone/else" },
      env,
    );

    expect(seen).toEqual([
      "POST /api/v1/sources/src-mem/ingest Bearer utp_mem",
    ]);
  });

  it("pushes nothing for a memory with no repo when GITHUB_ORG is unset", async () => {
    const pool = poolHolding({
      memories: [{ ...MEMORY_ROW, repo: null as unknown as string }],
    });

    await mirrorMemory(
      asPool(pool),
      { key: "gotchas", agentId: "claude-bogdan" },
      { ...env, GITHUB_ORG: "" },
    );

    expect(seen).toEqual([]);
  });

  it("reads nothing and pushes nothing when UTOPIA_API_URL is unset", async () => {
    const pool = poolHolding({ memories: [MEMORY_ROW] });

    await mirrorMemory(
      asPool(pool),
      { key: "gotchas", agentId: "claude-bogdan", repo: "re-cinq/lore" },
      {},
    );

    expect({ reads: pool.query.mock.calls.length, seen }).toEqual({
      reads: 0,
      seen: [],
    });
  });

  it("tombstones memory:claude-bogdan/gotchas once the row reads deleted", async () => {
    const pool = poolHolding({
      onboarded: ["re-cinq/lore"],
      memories: [{ ...MEMORY_ROW, live: false }],
      repoSources: LORE_SRC_1,
      memorySources: [MEMORIES_SOURCE],
    });

    await mirrorMemory(
      asPool(pool),
      { key: "gotchas", agentId: "claude-bogdan" },
      env,
    );

    expect(bodies).toEqual([
      {
        external_id: "memory:claude-bogdan/gotchas",
        filename: "gotchas",
        deleted: true,
      },
    ]);
  });
});

describe("mirrorEpisode", () => {
  it("pushes episode:e7 of re-cinq/lore to the base's episodes source", async () => {
    const pool = poolHolding({
      onboarded: ["re-cinq/lore"],
      repoSources: LORE_SRC_1,
      memorySources: [{ ...MEMORIES_SOURCE, id: "src-ep" }],
    });

    await mirrorEpisode(
      asPool(pool),
      {
        id: "e7",
        content: "Session in re-cinq/lore\n\nMoved the cursor.",
        createdAt: "2026-10-19T09:00:00+00:00",
        ref: "re-cinq/lore",
      },
      env,
    );

    expect({ seen, bodies }).toEqual({
      seen: ["POST /api/v1/sources/src-ep/ingest Bearer utp_mem"],
      bodies: [
        {
          external_id: "episode:e7",
          filename: "episode-e7",
          content: "Session in re-cinq/lore\n\nMoved the cursor.",
          doc_time: "2026-10-19T09:00:00+00:00",
        },
      ],
    });
  });

  it("pushes episode:e8, whose ref is a task path under re-cinq/lore, to re-cinq/lore's base and not the org's", async () => {
    const pool = poolHolding({
      onboarded: ["re-cinq/lore"],
      repoSources: LORE_SRC_1,
      memorySources: [{ ...MEMORIES_SOURCE, id: "src-ep" }],
    });

    await mirrorEpisode(
      asPool(pool),
      {
        id: "e8",
        content: "Run of implementation-loop on re-cinq/lore ended as success.",
        createdAt: "2026-10-19T09:05:00+00:00",
        ref: "re-cinq/lore/1f2e3d4c-5b6a-4789-8abc-def012345678",
      },
      env,
    );

    expect(seen).toEqual(["POST /api/v1/sources/src-ep/ingest Bearer utp_mem"]);
  });
});
