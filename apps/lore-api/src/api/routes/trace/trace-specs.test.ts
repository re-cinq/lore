import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../server/build-server.js";
import { makePool, useRateLimitSafeClock, AUTH, LEGACY_TOKEN } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

// The Dgraph-configured branches of GET /api/trace/specs. The null-client
// fail-soft (`{ specs: [] }`) and the 401 no-bearer gate are covered in
// trace.test.ts via the real env-gated createDgraphClient; here the client is
// faked so the success and error paths are reachable.
vi.mock("@re-cinq/lore-shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@re-cinq/lore-shared")>();
  return { ...actual, createDgraphClient: vi.fn(), listAllSpecDocuments: vi.fn() };
});

import { createDgraphClient, listAllSpecDocuments } from "@re-cinq/lore-shared";

const originalEnv = { ...process.env };
const get = () =>
  buildServer(() => makePool() as never).inject({ method: "GET", url: "/api/trace/specs", headers: AUTH });

describe("GET /api/trace/specs", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    vi.mocked(createDgraphClient).mockReturnValue({} as never);
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("returns the cross-repo spec list from Dgraph", async () => {
    const specs = [
      { repo: "o/r", filePath: "specs/a/spec.md" },
      { repo: "o/s", filePath: "specs/b/spec.md" },
    ];
    vi.mocked(listAllSpecDocuments).mockResolvedValue(specs);
    const res = await get();
    expect(res.statusCode).toBe(200);
    expect(res.result).toEqual({ specs });
  });

  it("returns 500 when the Dgraph read throws", async () => {
    vi.mocked(listAllSpecDocuments).mockRejectedValue(new Error("dgraph boom"));
    const res = await get();
    expect(res.statusCode).toBe(500);
    expect(res.result).toEqual({ error: "dgraph boom" });
  });
});
