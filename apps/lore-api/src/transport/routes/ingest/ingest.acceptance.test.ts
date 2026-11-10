import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../app/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

vi.mock("../../../work/spec-trace/ingest.js", () => ({
  ingestFiles: vi.fn(),
}));

import { ingestFiles } from "../../../work/spec-trace/ingest.js";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

const post = (body: unknown, pool: unknown) =>
  buildServer(() => pool as any).inject({
    method: "POST",
    url: "/api/ingest",
    headers: AUTH,
    payload: JSON.stringify(body),
  });

describe("POST /api/ingest (acceptance)", () => {
  useRateLimitSafeClock();

  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("records last_ingested_at only after a successful write", async () => {
    const pool = makePool();

    vi.mocked(ingestFiles).mockResolvedValueOnce({
      results: [{ status: "ingested", file: "a.ts" }],
      ingested: 1,
      deleted: 0,
      errors: 0,
      schema: "org_shared",
    });

    await post({ files: ["a.ts"], repo: "o/r" }, pool);

    const markIngestedCalls = pool.query.mock.calls.filter((c) =>
      String(c[0]).includes(
        "UPDATE lore.repos SET last_ingested_at = now() WHERE full_name = $1",
      ),
    );

    expect(markIngestedCalls.length).toBeGreaterThan(0);
    expect(markIngestedCalls[0][1]).toEqual(["o/r"]);
  });

  it("does not record last_ingested_at when no files landed", async () => {
    const pool = makePool();

    vi.mocked(ingestFiles).mockResolvedValueOnce({
      results: [{ status: "skipped", file: "a.ts" }],
      ingested: 0,
      deleted: 0,
      errors: 0,
      schema: "org_shared",
    });

    await post({ files: ["a.ts"], repo: "o/r" }, pool);

    const markIngestedCalls = pool.query.mock.calls.filter((c) =>
      String(c[0]).includes("last_ingested_at"),
    );

    expect(markIngestedCalls.length).toBe(0);
  });
});
