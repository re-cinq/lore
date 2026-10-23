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
        utopia: { kb_id: "kb-1", ontology_version: 7 },
      }),
    },
  }),
}));

import {
  mirrorCodeFor,
  mirrorReportFor,
  unmirrorCodeFor,
  unmirrorTestFilesFor,
} from "./mirror-coverage.js";

const seen: string[] = [];
const bodies: Record<string, unknown>[] = [];
let server: Server;
let answer: Record<string, unknown>;
let heldCoverageSource: boolean;

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
          ? { ingest_token: "utp_new", source: { id: "src-new" } }
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
  heldCoverageSource = true;
  vi.stubEnv("UTOPIA_TOKEN", "utp_pat_lore");
  vi.stubEnv("UTOPIA_WORKSPACE_ID", "ws-lore");
  pool.query.mockImplementation(async (sql: string) => {
    if (/FROM lore\.utopia_kind_sources/.test(sql)) {
      return {
        rows: heldCoverageSource
          ? [{ id: "src-cov", key: "utp_cov", kbId: "kb-1" }]
          : [],
      };
    }

    return { rows: [] };
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  process.env.UTOPIA_API_URL = process.env.UTOPIA_API_URL ?? "";
});

const REPORT = {
  report: {
    tests: [
      {
        id: "src/a.test.ts::counts rounds",
        name: "counts rounds",
        file: "src/a.test.ts",
        startLine: 4,
      },
    ],
    results: [],
  },
};

const CODE = {
  files: [
    {
      path: "src/x/b.ts",
      content: "export function advance(state: number) {\n  return state;\n}\n",
    },
  ],
};

describe("mirrorReportFor", () => {
  it("pushes test:src/a.test.ts to the test-coverage source src-cov under utp_cov", async () => {
    await mirrorReportFor("re-cinq/lore", REPORT);

    expect({
      seen,
      pushed: bodies.map((body) => body.external_id),
    }).toEqual({
      seen: ["POST /api/v1/sources/src-cov/statements Bearer utp_cov"],
      pushed: ["test:src/a.test.ts"],
    });
  });

  it("creates the statements source test-coverage in kb-1 first when re-cinq/lore has none, then pushes through it", async () => {
    heldCoverageSource = false;

    await mirrorReportFor("re-cinq/lore", REPORT);

    expect({ seen, created: bodies[0] }).toEqual({
      seen: [
        "POST /api/v1/kbs/kb-1/sources Bearer utp_pat_lore",
        "POST /api/v1/sources/src-new/statements Bearer utp_new",
      ],
      created: { kind: "statements", name: "test-coverage", config: {} },
    });
  });

  it("rejects naming test:src/a.test.ts when Utopia answers duplicate", async () => {
    answer = { action: "duplicate" };

    await expect(mirrorReportFor("re-cinq/lore", REPORT)).rejects.toThrow(
      new Error(
        "1 of 1 items failed: test:src/a.test.ts: duplicate, another document in the knowledge base holds the same content",
      ),
    );
  });

  it("calls Utopia for nothing when the report names no test", async () => {
    await mirrorReportFor("re-cinq/lore", {
      ...REPORT,
      report: { tests: [], results: [] },
    });

    expect(seen).toEqual([]);
  });

  it("calls Utopia for nothing on a deployment with no UTOPIA_API_URL", async () => {
    vi.stubEnv("UTOPIA_API_URL", "");

    await mirrorReportFor("re-cinq/lore", REPORT);

    expect(seen).toEqual([]);
  });
});

describe("unmirrorTestFilesFor", () => {
  it("posts the test:src/a.test.ts tombstone to src-cov", async () => {
    await unmirrorTestFilesFor("re-cinq/lore", ["src/a.test.ts"]);

    expect({ seen, bodies }).toEqual({
      seen: ["POST /api/v1/sources/src-cov/statements Bearer utp_cov"],
      bodies: [{ external_id: "test:src/a.test.ts", deleted: true }],
    });
  });
});

describe("mirrorCodeFor", () => {
  it("pushes code:src/x/b.ts to the test-coverage source src-cov under utp_cov", async () => {
    await mirrorCodeFor("re-cinq/lore", CODE);

    expect({
      seen,
      pushed: bodies.map((body) => body.external_id),
    }).toEqual({
      seen: ["POST /api/v1/sources/src-cov/statements Bearer utp_cov"],
      pushed: ["code:src/x/b.ts"],
    });
  });
});

describe("unmirrorCodeFor", () => {
  it("posts the code:src/x/b.ts tombstone to src-cov", async () => {
    await unmirrorCodeFor("re-cinq/lore", ["src/x/b.ts"]);

    expect({ seen, bodies }).toEqual({
      seen: ["POST /api/v1/sources/src-cov/statements Bearer utp_cov"],
      bodies: [{ external_id: "code:src/x/b.ts", deleted: true }],
    });
  });
});
