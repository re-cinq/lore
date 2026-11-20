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

    pool.query.mockImplementation(
      weeksOnly([
        {
          repo: "re-cinq/lore",
          week_key: "2026-W42",
          intro: "Utopia now holds the repo's git history.",
          changes: [],
          written_at: new Date("2026-10-19T06:00:00Z"),
        },
      ]),
    );
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

function weeksOnly(weeks: unknown[]) {
  return (sql: string) =>
    Promise.resolve({
      rows: sql.includes("lore.changelog_weeks") ? weeks : [],
    });
}

interface StoredTables {
  settings?: Record<string, unknown>;
  releases?: Array<Record<string, unknown>>;
  weeks?: Array<Record<string, unknown>>;
}

function tablesPool(tables: StoredTables) {
  return {
    query: (sql: string, params: unknown[] = []) =>
      Promise.resolve({ rows: rowsFor(sql, params, tables) }),
  };
}

function rowsFor(sql: string, params: unknown[], tables: StoredTables) {
  if (sql.includes("lore.changelog_releases")) {
    return (tables.releases ?? [])
      .filter(
        (row) => !params[1] || (row.range_to as Date) < (params[1] as Date),
      )
      .slice(0, params[2] as number);
  }

  if (sql.includes("lore.changelog_weeks")) {
    return tables.weeks ?? [];
  }

  return [{ settings: tables.settings ?? {} }];
}

function releaseRow(version: string, rangeTo: string) {
  return {
    repo: "re-cinq/lore",
    version,
    previous_tag: null,
    sha: "abc123",
    bump: "minor",
    range_from: null,
    range_to: new Date(rangeTo),
    summary: `Summary of ${version}`,
    changes: [],
    release_url: `https://github.com/re-cinq/lore/releases/tag/${version}`,
    published_to: null,
    announced_at: null,
    slack_ts: null,
    written_at: new Date(rangeTo),
  };
}

const week42Row = {
  repo: "re-cinq/lore",
  week_key: "2026-W42",
  intro: "Utopia now holds the repo's git history.",
  changes: [],
  written_at: new Date("2026-10-19T06:00:00Z"),
};

const WEEKS_ANSWER_FOR_NO_RELEASES =
  '{"weeks":[{"weekKey":"2026-W43","from":"2026-10-19T00:00:00.000Z","to":"2026-10-26T00:00:00.000Z","current":true,"intro":null,"changes":[{"kind":"pr","number":3055,"title":"Make the old source the test-coverage source","url":"https://github.com/re-cinq/lore/pull/3055","people":["gedaiu"],"at":"2026-10-21T10:00:00Z"}]},{"weekKey":"2026-W42","from":"2026-10-12T00:00:00.000Z","to":"2026-10-19T00:00:00.000Z","current":false,"intro":"Utopia now holds the repo\'s git history.","changes":[]}],"next":"2026-W42"}';

describe("GET /api/repos/{owner}/{repo}/changelog for a repository with releases", () => {
  useRateLimitSafeClock();
  const githubReads: string[] = [];

  beforeEach(() => {
    githubReads.length = 0;
    vi.setSystemTime(THURSDAY_W43);
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    vi.mocked(projectFor).mockResolvedValue({
      pulls: {
        listMergedSince: (since: string) => {
          githubReads.push(`merged since ${since}`);

          return Promise.resolve([
            pr3055,
            { ...pr3055, number: 3000, mergedAt: "2026-10-10T10:00:00Z" },
          ]);
        },
      },
      issues: { list: () => Promise.resolve([]) },
    } as never);
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function answer(url: string, tables: StoredTables) {
    return buildServer(() => tablesPool(tables) as never)
      .inject({ method: "GET", url, headers: AUTH })
      .then((res) => ({ status: res.statusCode, payload: res.payload }));
  }

  const changelog = "/api/repos/re-cinq/lore/changelog";

  it("answers the same bytes as before for a repo with no release block and no stored release", async () => {
    const res = await answer(`${changelog}?limit=2`, { weeks: [week42Row] });

    expect({ ...res, githubReads }).toEqual({
      status: 200,
      payload: WEEKS_ANSWER_FOR_NO_RELEASES,
      githubReads: ["merged since 2026-10-19T00:00:00.000Z"],
    });
  });

  it("answers releases for a repo with stored v1.1.0, newest first, with its range and summary", async () => {
    const { payload } = await answer(changelog, {
      releases: [releaseRow("v1.1.0", "2026-10-20T08:00:00Z")],
    });

    expect(JSON.parse(payload)).toMatchObject({
      mode: "releases",
      weeks: [],
      releases: [
        {
          version: "v1.1.0",
          to: "2026-10-20T08:00:00.000Z",
          summary: "Summary of v1.1.0",
          bump: "minor",
          releaseUrl: "https://github.com/re-cinq/lore/releases/tag/v1.1.0",
        },
      ],
      next: null,
    });
  });

  it("answers releases for a repo with only release.enabled, every change unreleased", async () => {
    const { payload } = await answer(changelog, {
      settings: { release: { enabled: true } },
    });

    expect(JSON.parse(payload)).toMatchObject({
      mode: "releases",
      releases: [],
      unreleased: {
        latestVersion: null,
        since: null,
        changes: [{ number: 3055 }, { number: 3000 }],
      },
    });
  });

  it("counts only pull request 3055 as unreleased after v1.1.0 ended 2026-10-20", async () => {
    const { payload } = await answer(changelog, {
      releases: [releaseRow("v1.1.0", "2026-10-20T08:00:00Z")],
    });

    expect(JSON.parse(payload).unreleased).toMatchObject({
      latestVersion: "v1.1.0",
      since: "2026-10-20T08:00:00.000Z",
      changes: [{ number: 3055 }],
    });
  });

  it("lists no unreleased change right after v1.2.0 ended 2026-10-22", async () => {
    const { payload } = await answer(changelog, {
      releases: [releaseRow("v1.2.0", "2026-10-22T11:00:00Z")],
    });

    expect(JSON.parse(payload).unreleased).toMatchObject({
      latestVersion: "v1.2.0",
      changes: [],
    });
  });

  it("pages three releases by cursor, reading GitHub on the first page only", async () => {
    const releases = [
      releaseRow("v1.3.0", "2026-10-22T11:00:00Z"),
      releaseRow("v1.2.0", "2026-10-15T11:00:00Z"),
      releaseRow("v1.1.0", "2026-10-08T11:00:00Z"),
    ];
    const first = JSON.parse(
      (await answer(`${changelog}?limit=2`, { releases })).payload,
    );
    const second = JSON.parse(
      (await answer(`${changelog}?limit=2&before=${first.next}`, { releases }))
        .payload,
    );

    expect({
      first: first.releases.map(
        (release: { version: string }) => release.version,
      ),
      cursor: first.next,
      second: second.releases.map(
        (release: { version: string }) => release.version,
      ),
      unreleasedOnSecond: second.unreleased,
      githubReads: githubReads.length,
    }).toEqual({
      first: ["v1.3.0", "v1.2.0"],
      cursor: "2026-10-15T11:00:00.000Z",
      second: ["v1.1.0"],
      unreleasedOnSecond: null,
      githubReads: 1,
    });
  });

  it("returns 400 for a week key as before on a repo with releases", async () => {
    const res = await answer(`${changelog}?before=2026-W42`, {
      releases: [releaseRow("v1.1.0", "2026-10-20T08:00:00Z")],
    });

    expect({ status: res.status, githubReads }).toEqual({
      status: 400,
      githubReads: [],
    });
  });

  it("returns 400 for a timestamp as before on a repo with weeks", async () => {
    const res = await answer(
      `${changelog}?before=2026-10-15T11:00:00.000Z`,
      {},
    );

    expect(res.status).toBe(400);
  });
});
