import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../../outbound/project-boot.js", () => ({ projectFor: vi.fn() }));

import { buildServer } from "../../../app/build-server.js";
import { projectFor } from "../../../outbound/project-boot.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };
const THURSDAY_W43 = Date.parse("2026-10-22T12:00:00Z");

const pr3055 = {
  repo: "re-cinq/lore",
  number: 3055,
  title: "Make the old source the test-coverage source",
  branch: "feat/x",
  state: "merged",
  labels: [],
  url: "https://github.com/re-cinq/lore/pull/3055",
  author: "gedaiu",
  mergedAt: "2026-10-21T10:00:00Z",
};

describe("GET /api/repos/{owner}/{repo}/changelog", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    vi.setSystemTime(THURSDAY_W43);
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    vi.mocked(projectFor).mockResolvedValue({
      pulls: { listMergedSince: () => Promise.resolve([pr3055]) },
      issues: { list: () => Promise.resolve([]) },
    } as never);
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  function get(url: string, pool: unknown = makePool()) {
    return buildServer(() => pool as never).inject({
      method: "GET",
      url,
      headers: AUTH,
    });
  }

  it("leads with 2026-W43 read live from GitHub, pull request 3055 under gedaiu, with no introduction", async () => {
    const res = await get("/api/repos/re-cinq/lore/changelog?limit=2");
    const [first] = JSON.parse(res.payload).weeks;

    expect({ status: res.statusCode, first }).toMatchObject({
      status: 200,
      first: {
        weekKey: "2026-W43",
        current: true,
        intro: null,
        changes: [{ kind: "pr", number: 3055, people: ["gedaiu"] }],
      },
    });
  });

  it("shows 2026-W42's stored introduction", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({
      rows: [
        {
          repo: "re-cinq/lore",
          week_key: "2026-W42",
          intro: "Utopia now holds the repo's git history.",
          changes: [],
          written_at: new Date("2026-10-19T06:00:00Z"),
        },
      ],
    });
    const res = await get("/api/repos/re-cinq/lore/changelog?limit=2", pool);

    expect(JSON.parse(res.payload).weeks[1]).toMatchObject({
      weekKey: "2026-W42",
      current: false,
      intro: "Utopia now holds the repo's git history.",
    });
  });

  it("returns 400 for before=yesterday, which is not a week", async () => {
    expect(
      (await get("/api/repos/re-cinq/lore/changelog?before=yesterday"))
        .statusCode,
    ).toBe(400);
  });

  it("returns 503 when the pool is null", async () => {
    expect(
      (await get("/api/repos/re-cinq/lore/changelog", null)).statusCode,
    ).toBe(503);
  });
});
