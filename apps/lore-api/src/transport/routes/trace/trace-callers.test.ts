import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createDgraphClient, projectCodeFile } from "@re-cinq/lore-shared";
import { dgraphReachable } from "@re-cinq/lore-shared/lib/dgraph-test-gate.js";
import { buildServer } from "../../../app/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };
const DGRAPH_HTTP = process.env.DGRAPH_HTTP ?? "http://localhost:8081";

const get = (url: string) =>
  buildServer(() => makePool() as never).inject({
    method: "GET",
    url,
    headers: AUTH,
  });

describe("GET /api/repos/:owner/:repo/trace/callers", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    delete process.env.LORE_DGRAPH_HTTP;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("answers an empty callers list for nextTransition when no graph is configured", async () => {
    const res = await get("/api/repos/o/r/trace/callers?symbol=nextTransition");

    expect(JSON.parse(res.payload)).toEqual({ callers: [] });
  });

  it("answers 400 when the symbol is missing", async () => {
    const res = await get("/api/repos/o/r/trace/callers");

    expect(res.statusCode).toBe(400);
  });
});

const reachable = await dgraphReachable();

describe.skipIf(!reachable)("GET trace/callers (live Dgraph)", () => {
  useRateLimitSafeClock();
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("answers advance in src/runner.ts as the caller of nextTransition", async () => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    process.env.LORE_DGRAPH_HTTP = DGRAPH_HTTP;
    const repo = `test-callers/${randomUUID()}`;
    const dgraph = createDgraphClient(process.env)!;

    await projectCodeFile(
      {
        repo,
        filePath: "src/transition.ts",
        content: "export function nextTransition() {\n  return 1;\n}",
      },
      dgraph,
    );
    await projectCodeFile(
      {
        repo,
        filePath: "src/runner.ts",
        content:
          'import { nextTransition } from "./transition.js";\nexport const advance = () => nextTransition();',
      },
      dgraph,
    );
    const res = await get(
      `/api/repos/${repo}/trace/callers?symbol=nextTransition`,
    );

    expect(JSON.parse(res.payload)).toEqual({
      callers: [{ filePath: "src/runner.ts", symbol: "advance", startLine: 2 }],
    });
  });
});
