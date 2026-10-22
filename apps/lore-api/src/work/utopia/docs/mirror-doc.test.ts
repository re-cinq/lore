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
import { createServer, type IncomingMessage, type Server } from "node:http";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { makePool } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const pool = makePool();

vi.mock("@re-cinq/lore-server-core/platform/db.js", () => ({
  getPool: () => pool,
}));
vi.mock("../../../outbound/project-boot.js", () => ({
  projectFor: async () => ({
    settings: {
      rawSettings: async () => ({
        utopia: { kb_id: "kb-1", source_id: "src-1", ontology_version: 7 },
      }),
    },
    repo: { read: async () => null },
  }),
}));

import { mirrorDocFor, unmirrorDocFor } from "./mirror-doc.js";

const seen: string[] = [];
const bodies: Record<string, unknown>[] = [];
let server: Server;
let answer: Record<string, unknown>;
let held: string[];

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let body = "";

    req.on("data", (chunk) => (body += String(chunk)));
    req.on("end", () => resolve(body));
  });

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const body = JSON.parse(await readBody(req)) as Record<string, unknown>;

    seen.push(`${req.method} ${req.url} ${req.headers.authorization}`);
    bodies.push(body);
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify(
        req.url?.endsWith("/sources")
          ? {
              ingest_token: `utp_new_${String(body.name)}`,
              source: { id: `src-new-${String(body.name)}` },
            }
          : answer,
      ),
    );
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

beforeEach(() => {
  seen.length = 0;
  bodies.length = 0;
  answer = { action: "created" };
  held = ["docs", "test-coverage"];
  vi.stubEnv("UTOPIA_TOKEN", "utp_pat_lore");
  vi.stubEnv("UTOPIA_WORKSPACE_ID", "ws-lore");
  pool.query.mockImplementation(async (sql: string, params: string[]) => {
    if (/FROM lore\.utopia_kind_sources/.test(sql)) {
      return {
        rows: held.includes(params[1])
          ? [{ id: `src-${params[1]}`, key: `utp_${params[1]}`, kbId: "kb-1" }]
          : [],
      };
    }

    if (/FROM lore\.utopia_sources/.test(sql)) {
      return {
        rows: [{ kb_id: "kb-1", source_id: "src-1", source_key: "utp_k" }],
      };
    }

    return { rows: [] };
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const DOC = {
  path: "specs/mirror/spec.md",
  content: "## Chain\n\n- FR1 — Pushed.\n",
  kind: "spec" as const,
  commit: "0123456789abcdef0123456789abcdef01234567",
};

describe("mirrorDocFor", () => {
  it("pushes the whole spec to the docs source and its statement to the test-coverage source, each under its own key", async () => {
    await mirrorDocFor("re-cinq/lore", DOC);

    expect({
      seen,
      ids: bodies.map((body) => body.external_id),
      content: bodies[0].content,
    }).toEqual({
      seen: [
        "POST /api/v1/sources/src-docs/ingest Bearer utp_docs",
        "POST /api/v1/sources/src-test-coverage/statements Bearer utp_test-coverage",
      ],
      ids: ["doc:specs/mirror/spec.md", "stmt:specs/mirror/spec.md#0000"],
      content:
        "File: specs/mirror/spec.md\nRepository: re-cinq/lore\nKind: spec\n\n## Chain\n\n- FR1 — Pushed.\n",
    });
  });

  it("creates the api source docs and the statements source test-coverage in kb-1 first when re-cinq/lore has neither", async () => {
    held = [];

    await mirrorDocFor("re-cinq/lore", DOC);

    expect({
      created: bodies.filter((body) => body.config).map((body) => body.name),
      pushes: seen.filter((call) => !call.includes("/kbs/")),
    }).toEqual({
      created: ["docs", "test-coverage"],
      pushes: [
        "POST /api/v1/sources/src-new-docs/ingest Bearer utp_new_docs",
        "POST /api/v1/sources/src-new-test-coverage/statements Bearer utp_new_test-coverage",
      ],
    });
  });

  it("rejects naming doc:specs/mirror/spec.md when Utopia answers duplicate", async () => {
    answer = { action: "duplicate" };

    await expect(mirrorDocFor("re-cinq/lore", DOC)).rejects.toThrow(
      new Error(
        "2 of 2 items failed: doc:specs/mirror/spec.md: duplicate, another document in the knowledge base holds the same content",
      ),
    );
  });

  it("calls Utopia for nothing on a deployment with no UTOPIA_API_URL", async () => {
    vi.stubEnv("UTOPIA_API_URL", "");

    await mirrorDocFor("re-cinq/lore", DOC);

    expect(seen).toEqual([]);
  });
});

describe("unmirrorDocFor", () => {
  it("posts the doc:adrs/ADR-1.md tombstone to the docs source and nothing to test-coverage", async () => {
    await unmirrorDocFor("re-cinq/lore", "adrs/ADR-1.md");

    expect({ seen, bodies }).toEqual({
      seen: ["POST /api/v1/sources/src-docs/ingest Bearer utp_docs"],
      bodies: [
        {
          external_id: "doc:adrs/ADR-1.md",
          filename: "adrs/ADR-1.md",
          deleted: true,
        },
      ],
    });
  });
});
