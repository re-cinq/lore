import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../app/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

vi.mock("@re-cinq/lore-shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@re-cinq/lore-shared")>();

  return {
    ...actual,
    createDgraphClient: vi.fn(),
    failuresTouching: vi.fn(),
  };
});

import { createDgraphClient, failuresTouching } from "@re-cinq/lore-shared";

const originalEnv = { ...process.env };
const base = "/api/repos/o/r/trace/failures-touching";

const get = (url: string) =>
  buildServer(() => makePool() as never).inject({
    method: "GET",
    url,
    headers: AUTH,
  });

const hit = {
  stationRunId: "sr-1",
  nodeId: "validate",
  iteration: 1,
  failureClass: "lint",
  failureDetail: "src/a.ts:12 no-unused-vars",
  commit: "a1b2c3d",
  occurredAt: "2026-09-09T10:00:00.000Z",
  resolvedByCommit: "e4f5a6b",
};

describe("GET /api/repos/:owner/:repo/trace/failures-touching", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    vi.mocked(createDgraphClient).mockReturnValue({} as never);
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("returns 400 when no path names the source file", async () => {
    const res = await get(base);

    expect(res.statusCode).toBe(400);
    expect(res.result).toEqual({ error: "path query param required" });
  });

  it("returns the recorded failures under a failures key", async () => {
    vi.mocked(failuresTouching).mockResolvedValue([hit]);
    const res = await get(`${base}?path=src/a.ts`);

    expect(res.result).toEqual({ failures: [hit] });
  });

  it("queries the graph with the repo and the requested path", async () => {
    vi.mocked(failuresTouching).mockResolvedValue([]);

    await get(`${base}?path=src/a.ts`);

    expect(vi.mocked(failuresTouching).mock.calls[0].slice(1)).toEqual([
      "o/r",
      "src/a.ts",
    ]);
  });

  it("returns an empty list when no Dgraph client is configured", async () => {
    vi.mocked(createDgraphClient).mockReturnValue(null);
    const res = await get(`${base}?path=src/a.ts`);

    expect(res.result).toEqual({ failures: [] });
    expect(failuresTouching).not.toHaveBeenCalled();
  });
});
