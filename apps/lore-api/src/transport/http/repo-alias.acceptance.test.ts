import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LEGACY_TOKEN,
  makePool,
  useRateLimitSafeClock,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import { InMemorySettings } from "@re-cinq/lore-shared/project/settings/settings-memory.js";
import { buildServer } from "../../app/build-server.js";

const originalEnv = { ...process.env };
const MIRROR = "acme/public";
const PRIVATE = "acme/private";
const PRIVATE_ONLY_TOKEN = "private-session";
const MIRROR_ONLY_TOKEN = "mirror-session";

const OPTED_IN_ROUTES = [
  "POST /api/context",
  "POST /api/memory",
  "POST /api/session-summary",
];

describe("a public mirror's name on the real server", () => {
  useRateLimitSafeClock();

  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("reads the changelog rows of acme/private for GET /api/repos/acme/public/changelog", async () => {
    const { call, askedRepos } = createLoreServer();

    await call("GET", `/api/repos/${MIRROR}/changelog`, PRIVATE_ONLY_TOKEN);

    expect(askedRepos()).toEqual({ private: true, mirror: false });
  });

  it("answers 403 and reads nothing of acme/private to a person whose repo list holds only acme/public", async () => {
    const { call, askedRepos } = createLoreServer();
    const res = await call(
      "GET",
      `/api/repos/${MIRROR}/changelog`,
      MIRROR_ONLY_TOKEN,
    );

    expect({ status: res.statusCode, asked: askedRepos() }).toEqual({
      status: 403,
      asked: { private: false, mirror: false },
    });
  });

  it("stores a session summary naming acme/public under acme/private", async () => {
    const { call, askedRepos } = createLoreServer();
    const res = await call("POST", "/api/session-summary", LEGACY_TOKEN, {
      session_log: "fixed the release notes",
      repo: MIRROR,
    });

    expect({ status: res.statusCode, asked: askedRepos() }).toEqual({
      status: 200,
      asked: { private: true, mirror: false },
    });
  });

  it("answers 409 to PUT /api/repos/acme/public/loops/review and POST /api/review/start naming acme/public", async () => {
    const { call } = createLoreServer();
    const loop = await call(
      "PUT",
      `/api/repos/${MIRROR}/loops/review`,
      LEGACY_TOKEN,
      { enabled: true },
    );
    const review = await call("POST", "/api/review/start", LEGACY_TOKEN, {
      repo: MIRROR,
      pr_number: 1,
    });

    expect([loop.statusCode, review.statusCode]).toEqual([409, 409]);
  });

  it("opts in exactly the routes the public mirror may be written through", () => {
    const { server } = createLoreServer();
    const optedIn = server
      .table()
      .filter(
        (route) =>
          (route.settings.app as Record<string, unknown> | undefined)
            ?.mirrorWritable === true,
      )
      .map((route) => `${route.method.toUpperCase()} ${route.path}`)
      .sort();

    expect(optedIn).toEqual(OPTED_IN_ROUTES);
  });
});

function createLoreServer() {
  const pool = makePool();
  const params: unknown[][] = [];
  const settings = new InMemorySettings([
    { full_name: PRIVATE, settings: { public_mirror: MIRROR } },
  ]);

  pool.query.mockImplementation((rawSql: string, values?: unknown[]) => {
    const sql = String(rawSql);

    if (sql.includes("UPDATE pipeline.api_tokens")) {
      return Promise.resolve({ rows: tokenRows(values) });
    }
    params.push(values ?? []);

    return Promise.resolve({ rows: [] });
  });

  const server = buildServer(
    () => pool as never,
    0,
    undefined,
    (name) => settings.mirrorOwner(name),
  );

  return {
    server,
    askedRepos: () => {
      const flat = params.flat().map((value) => String(value).toLowerCase());

      return {
        private: flat.includes(PRIVATE),
        mirror: flat.includes(MIRROR),
      };
    },
    call: (
      method: "GET" | "POST" | "PUT",
      url: string,
      token: string,
      payload?: object,
    ) =>
      server.inject({
        method,
        url,
        payload,
        headers: { authorization: `Bearer ${token}` },
      }),
  };
}

const sha256 = (raw: string): string =>
  createHash("sha256").update(raw).digest("hex");

const TOKENS_BY_HASH: Record<string, unknown> = {
  [sha256(PRIVATE_ONLY_TOKEN)]: personToken("pat", [PRIVATE]),
  [sha256(MIRROR_ONLY_TOKEN)]: personToken("mia", [MIRROR]),
};

function tokenRows(values: unknown[] | undefined): unknown[] {
  const row = TOKENS_BY_HASH[String(values?.[0])];

  return row ? [row] : [];
}

function personToken(login: string, repos: string[]) {
  return {
    scopes: ["admin"],
    kind: "user",
    login,
    displayName: login,
    avatarUrl: null,
    repos,
    startedAt: new Date("2026-11-18T10:00:00Z"),
    expiresAt: null,
  };
}
