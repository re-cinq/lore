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

vi.mock("@re-cinq/lore-server-core/features/context/cross-repo.js", () => ({
  repoContextSettings: vi.fn(),
}));
vi.mock("@re-cinq/lore-shared/utopia/utopia-reads.js", () => ({
  utopiaReadsFrom: vi.fn(),
}));

import { hybridSearch } from "@re-cinq/lore-server-core/platform/db.js";
import { repoContextSettings } from "@re-cinq/lore-server-core/features/context/cross-repo.js";
import { utopiaReadsFrom } from "@re-cinq/lore-shared/utopia/utopia-reads.js";

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
    vi.mocked(repoContextSettings).mockResolvedValue({ crossRepo: false });
    vi.mocked(utopiaReadsFrom).mockReturnValue(null);
  });

  const mirrorWithHits = (hits: object[]) => {
    vi.mocked(repoContextSettings).mockResolvedValue({
      crossRepo: false,
      utopiaMirror: { kbId: "kb-1", docsSourceId: "src-docs" },
    });
    vi.mocked(utopiaReadsFrom).mockReturnValue({
      search: vi.fn().mockResolvedValue({ hits, hasMore: false }),
      documentByExternalId: vi.fn(),
    } as never);
  };
  const docHit = (path: string, score: number, text: string) => ({
    sourceId: "src-docs",
    externalId: `doc:${path}`,
    seq: 0,
    score,
    text,
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
      "/api/search-context?query=how%20does%20auto-merge%20decide%20to%20squash&backend=lore",
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

    const res = await get("/api/search-context?query=auto-merge&backend=lore");
    const [first] = (res.result as { results: { score: number }[] }).results;

    expect(typeof first.score).toBe("number");
  });

  it("retries a provisioned team schema's miss against org_shared", async () => {
    vi.mocked(hybridSearch)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([hit("org-wide convention", 0.02)]);

    const res = await get(
      "/api/search-context?query=conventions&team=platform&backend=lore",
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

  it("answers no passages and a no-reader note when the request names no repo, without searching Lore", async () => {
    const res = await get("/api/search-context?query=deploys");

    expect({
      body: res.result,
      searched: vi.mocked(hybridSearch).mock.calls.length,
    }).toEqual({
      body: { results: [], notes: ["search_context: no Utopia reader yet"] },
      searched: 0,
    });
  });

  it("answers the repo's docs-source documents scored so the best is 1 for repo=o/r with no backend", async () => {
    mirrorWithHits([
      docHit("adrs/ADR-016.md", 0.8, "two keys"),
      docHit("docs/deploy.md", 0.4, "deploy on Friday"),
    ]);

    const res = await get("/api/search-context?query=deploys&repo=o/r");

    expect({
      body: res.result,
      searched: vi.mocked(hybridSearch).mock.calls.length,
    }).toEqual({
      body: {
        results: [
          {
            content: "two keys",
            score: 1,
            source_path: "adrs/ADR-016.md",
            backend: "utopia",
          },
          {
            content: "deploy on Friday",
            score: 0.5,
            source_path: "docs/deploy.md",
            backend: "utopia",
          },
        ],
      },
      searched: 0,
    });
  });

  it("answers the no-reader note for backend=utopia with repo=o/r when the repo has no mirror", async () => {
    const res = await get(
      "/api/search-context?query=deploys&backend=utopia&repo=o/r",
    );

    expect(res.result).toEqual({
      results: [],
      notes: ["search_context: no Utopia reader yet"],
    });
  });

  it("answers Lore's passages first, then Utopia's, each labelled, for backend=both with repo=o/r", async () => {
    mirrorWithHits([docHit("docs/deploy.md", 0.4, "deploy on Thursday")]);
    vi.mocked(hybridSearch).mockResolvedValue([hit("deploy on Friday", 0.03)]);

    const res = await get(
      "/api/search-context?query=deploys&backend=both&repo=o/r",
    );

    expect(res.result).toEqual({
      results: [
        {
          content: "deploy on Friday",
          score: 0.03,
          source_path: null,
          backend: "lore",
        },
        {
          content: "deploy on Thursday",
          score: 1,
          source_path: "docs/deploy.md",
          backend: "utopia",
        },
      ],
    });
  });

  it("answers Lore's passages plus the no-reader note for backend=both without a repo", async () => {
    vi.mocked(hybridSearch).mockResolvedValue([hit("deploy on Friday", 0.03)]);

    const res = await get("/api/search-context?query=deploys&backend=both");

    expect(res.result).toEqual({
      results: [
        {
          content: "deploy on Friday",
          score: 0.03,
          source_path: null,
          backend: "lore",
        },
      ],
      notes: ["search_context: no Utopia reader yet"],
    });
  });

  it("refuses a backend of dgraph with 400", async () => {
    const res = await get("/api/search-context?query=deploys&backend=dgraph");

    expect(res.statusCode).toBe(400);
  });
});
