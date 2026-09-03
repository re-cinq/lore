import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../server/build-server.js";
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
    listAllAdrDocuments: vi.fn(),
  };
});

import { createDgraphClient, listAllAdrDocuments } from "@re-cinq/lore-shared";

const originalEnv = { ...process.env };
const get = () =>
  buildServer(() => makePool() as never).inject({
    method: "GET",
    url: "/api/trace/adrs",
    headers: AUTH,
  });

describe("GET /api/trace/adrs", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    vi.mocked(createDgraphClient).mockReturnValue({} as never);
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("returns the cross-repo ADR list from Dgraph", async () => {
    const adrs = [
      {
        repo: "o/r",
        filePath: "adrs/ADR-001-x.md",
        status: { status: "shipped" as const, label: "Accepted" },
      },
      { repo: "o/s", filePath: "adrs/ADR-002-y.md", status: null },
    ];

    vi.mocked(listAllAdrDocuments).mockResolvedValue(adrs);
    const res = await get();

    expect(res.statusCode).toBe(200);
    expect(res.result).toEqual({ adrs });
  });

  it("returns 500 when the Dgraph read throws", async () => {
    vi.mocked(listAllAdrDocuments).mockRejectedValue(new Error("dgraph boom"));
    const res = await get();

    expect(res.statusCode).toBe(500);
    expect(res.result).toEqual({ error: "dgraph boom" });
  });
});
