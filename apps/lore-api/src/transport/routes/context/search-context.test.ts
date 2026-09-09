import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildServer } from "../../../app/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

vi.mock("@re-cinq/lore-server-core/platform/db.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@re-cinq/lore-server-core/platform/db.js")
  >()),
  hybridSearch: vi.fn(),
}));

import { hybridSearch } from "@re-cinq/lore-server-core/platform/db.js";

const hit = (content: string, score: number, file_path?: string) => ({
  id: content,
  content,
  metadata: file_path ? { file_path } : {},
  rrf_score: score,
});

const get = (url: string) =>
  buildServer(() => makePool() as never).inject({
    method: "GET",
    url,
    headers: AUTH,
  });

describe("GET /api/search-context", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    vi.mocked(hybridSearch).mockReset();
  });

  it("answers a natural-language query with scored passages carrying their source path", async () => {
    vi.mocked(hybridSearch).mockResolvedValue([
      hit(
        "auto-merge squashes when every path matches",
        0.031,
        "adrs/ADR-016.md",
      ),
    ]);

    const res = await get(
      "/api/search-context?query=how%20does%20auto-merge%20decide%20to%20squash",
    );

    expect({ status: res.statusCode, body: res.result }).toEqual({
      status: 200,
      body: {
        results: [
          {
            content: "auto-merge squashes when every path matches",
            score: 0.031,
            source_path: "adrs/ADR-016.md",
          },
        ],
      },
    });
  });

  it("sends 0.0163 as a number when pg hands back the numeric as a string", async () => {
    vi.mocked(hybridSearch).mockResolvedValue([
      {
        id: "c1",
        content: "auto-merge squashes",
        metadata: {},
        rrf_score: "0.01639344262295081967" as unknown as number,
      },
    ]);

    const res = await get("/api/search-context?query=auto-merge");
    const [first] = (res.result as { results: { score: number }[] }).results;

    expect(typeof first.score).toBe("number");
  });

  it("retries a provisioned team schema's miss against org_shared", async () => {
    vi.mocked(hybridSearch)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([hit("org-wide convention", 0.02)]);

    const res = await get(
      "/api/search-context?query=conventions&team=platform",
    );

    expect({
      schemas: vi.mocked(hybridSearch).mock.calls.map((c) => c[1]),
      body: res.result,
    }).toEqual({
      schemas: ["platform", "org_shared"],
      body: {
        results: [
          { content: "org-wide convention", score: 0.02, source_path: null },
        ],
      },
    });
  });

  it("refuses an empty query with 400 before searching", async () => {
    const res = await get("/api/search-context?query=");

    expect({
      status: res.statusCode,
      searched: vi.mocked(hybridSearch).mock.calls.length,
    }).toEqual({ status: 400, searched: 0 });
  });
});
