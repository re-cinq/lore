import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LEGACY_TOKEN,
  makePool,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import { setPool } from "@re-cinq/lore-server-core/platform/db.js";
import { buildServer } from "../../../app/build-server.js";

const API_URL = "https://lore-api.example.com";
const UI_URL = "https://lore-ui.example.com";
const GITHUB_ORG = "acme";
const INSTALLATION_ID = "42";
const ENCRYPTION_KEY = randomBytes(32).toString("base64");
const USER_ACCESS_TOKEN = "ghu_installation_user_access";
const USER_REFRESH_TOKEN = "ghr_installation_user_refresh";
const BASE_NOW_MS = new Date("2026-11-21T12:00:00.000Z").getTime();

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = globalThis.fetch;

let clockStep = 0;

interface RepoRecord {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  onboardingPrUrl: string | null;
  onboardingPrMerged: boolean;
  onboardedAt: Date;
  settings: Record<string, unknown>;
}

type ChunkRecord = {
  id: string;
  repo: string | null;
  content: string;
  metadata: Record<string, unknown>;
  rrf_score: number;
};

type MemoryRecord = {
  key: string;
  value: string;
  agent_id: string;
  score: number;
  source: "memory" | "fact" | "episode";
  repo: string | null;
};

interface GithubRouteConfig {
  userRepos?: string[];
  installationUserPages: Array<{ status: number; repos: string[] }>;
  appInstallationRepos?: string[];
  utopiaHitsByKb?: Record<string, Array<{ path: string; text: string }>>;
}

describe("Installation-scoped repository access and refresh (FR-030 to FR-140)", () => {
  beforeEach(() => {
    const startMs = BASE_NOW_MS + clockStep++ * 120_000;

    vi.useFakeTimers({ now: startMs, toFake: ["Date"] });
    configureEnv();
  });

  afterEach(() => {
    vi.useRealTimers();
    setPool(null as never);
    globalThis.fetch = ORIGINAL_FETCH;
    process.env = { ...ORIGINAL_ENV };
  });

  it("shows a person on GET /api/repos, GET /api/repos/available, and GET /api/inbox only repositories returned by GET /user/installations/{installation_id}/repositories asked with that person's token", async () => {
    const harness = createHarness({
      userRepos: ["other/outside-installation"],
      installationUserPages: [
        { status: 200, repos: ["acme/app", "acme/open"] },
      ],
      appInstallationRepos: ["acme/app", "acme/open", "other/unonboarded"],
    });

    seedCatalog(harness, [
      repoRow("acme/app", {
        onboardingPrUrl: "https://github.com/acme/app/pull/1",
        onboardedAt: new Date("2026-11-21T10:00:00.000Z"),
      }),
      repoRow("other/outside-installation", {
        onboardingPrUrl: "https://github.com/other/outside-installation/pull/2",
        onboardedAt: new Date("2026-11-21T10:01:00.000Z"),
      }),
      repoRow("other/secret", {
        onboardingPrUrl: "https://github.com/other/secret/pull/3",
        onboardedAt: new Date("2026-11-21T10:02:00.000Z"),
      }),
    ]);

    const token = await signIn(harness.server);
    const personRepos = await callApi(harness.server, "/api/repos", token);
    const serviceRepos = await callApi(
      harness.server,
      "/api/repos",
      LEGACY_TOKEN,
    );
    const personAvailable = await callApi(
      harness.server,
      "/api/repos/available",
      token,
    );
    const serviceAvailable = await callApi(
      harness.server,
      "/api/repos/available",
      LEGACY_TOKEN,
    );
    const personInbox = await callApi(harness.server, "/api/inbox", token);
    const serviceInbox = await callApi(
      harness.server,
      "/api/inbox",
      LEGACY_TOKEN,
    );

    expect({
      personRepos: [personRepos.statusCode, repoFullNamesOf(personRepos)],
      serviceRepos: [serviceRepos.statusCode, repoFullNamesOf(serviceRepos)],
      personAvailable: [
        personAvailable.statusCode,
        availableNamesOf(personAvailable),
      ],
      serviceAvailable: [
        serviceAvailable.statusCode,
        availableNamesOf(serviceAvailable),
      ],
      personInbox: [personInbox.statusCode, inboxReposOf(personInbox)],
      serviceInbox: [serviceInbox.statusCode, inboxReposOf(serviceInbox)],
      installationAuthHeaders: [
        ...new Set(harness.installationUserAuthHeaders),
      ],
    }).toEqual({
      personRepos: [200, ["acme/app"]],
      serviceRepos: [
        200,
        ["acme/app", "other/outside-installation", "other/secret"],
      ],
      personAvailable: [200, ["acme/open"]],
      serviceAvailable: [200, ["acme/open", "other/unonboarded"]],
      personInbox: [200, ["acme/app", "acme/app"]],
      serviceInbox: [
        200,
        [
          "acme/app",
          "acme/app",
          "other/outside-installation",
          "other/outside-installation",
          "other/secret",
          "other/secret",
        ],
      ],
      installationAuthHeaders: [`Bearer ${USER_ACCESS_TOKEN}`],
    });
  });

  it("shows a person on GET /api/search-context only results belonging to a repository returned by GET /user/installations/{installation_id}/repositories", async () => {
    const harness = createHarness({
      installationUserPages: [{ status: 200, repos: ["acme/app"] }],
      utopiaHitsByKb: {
        "kb-acme": [{ path: "docs/deploy.md", text: "acme utopia hit" }],
        "kb-secret": [{ path: "docs/deploy.md", text: "secret utopia hit" }],
      },
    });

    seedCatalog(harness, [
      repoRow("acme/app", {
        settings: { utopia: { kb_id: "kb-acme", docs_source_id: "src-docs" } },
      }),
      repoRow("other/secret", {
        settings: {
          utopia: { kb_id: "kb-secret", docs_source_id: "src-docs" },
        },
      }),
    ]);
    harness.chunks.push(
      chunkRow("c-acme", "acme/app", "deploy acme app"),
      chunkRow("c-secret", "other/secret", "deploy secret repo"),
      chunkRow("c-none", null, "deploy unscoped note"),
    );

    const token = await signIn(harness.server);
    const personSpan = await callApi(
      harness.server,
      "/api/search-context?query=deploy&backend=lore",
      token,
    );
    const serviceSpan = await callApi(
      harness.server,
      "/api/search-context?query=deploy&backend=lore",
      LEGACY_TOKEN,
    );
    const personAllowedRepo = await callApi(
      harness.server,
      "/api/search-context?query=deploy&repo=acme/app&backend=utopia",
      token,
    );
    const personDeniedRepo = await callApi(
      harness.server,
      "/api/search-context?query=deploy&repo=other/secret&backend=utopia",
      token,
    );

    expect({
      personSpan: [personSpan.statusCode, searchContentsOf(personSpan)],
      serviceSpan: [serviceSpan.statusCode, searchContentsOf(serviceSpan)],
      personAllowedRepo: [
        personAllowedRepo.statusCode,
        searchContentsOf(personAllowedRepo),
      ],
      personDeniedStatus: personDeniedRepo.statusCode,
    }).toEqual({
      personSpan: [200, ["deploy acme app"]],
      serviceSpan: [
        200,
        ["deploy acme app", "deploy secret repo", "deploy unscoped note"],
      ],
      personAllowedRepo: [200, ["acme utopia hit"]],
      personDeniedStatus: 403,
    });
    expect(personDeniedRepo.statusCode).toBe(403);
  });

  it("shows a person on GET /api/memory-search only results belonging to a repository returned by GET /user/installations/{installation_id}/repositories", async () => {
    const harness = createHarness({
      installationUserPages: [{ status: 200, repos: ["acme/app"] }],
    });

    seedCatalog(harness, [repoRow("acme/app"), repoRow("other/secret")]);
    harness.memories.push(
      memoryRow("acme-mem", "acme/app", "memory"),
      memoryRow("secret-mem", "other/secret", "memory"),
      memoryRow("unscoped-mem", null, "memory"),
      memoryRow("acme-fact", "acme/app", "fact"),
      memoryRow("secret-fact", "other/secret", "episode"),
      memoryRow("unscoped-fact", null, "fact"),
    );

    const token = await signIn(harness.server);
    const personSpan = await callApi(
      harness.server,
      "/api/memory-search?q=cache",
      token,
    );
    const personScoped = await callApi(
      harness.server,
      "/api/memory-search?q=cache&repo=acme/app",
      token,
    );
    const serviceSpan = await callApi(
      harness.server,
      "/api/memory-search?q=cache",
      LEGACY_TOKEN,
    );
    const personDenied = await callApi(
      harness.server,
      "/api/memory-search?q=cache&repo=other/secret",
      token,
    );

    expect({
      personSpan: [personSpan.statusCode, memoryKeysOf(personSpan)],
      personScoped: [personScoped.statusCode, memoryKeysOf(personScoped)],
      serviceSpan: [serviceSpan.statusCode, memoryKeysOf(serviceSpan)],
      personDeniedStatus: personDenied.statusCode,
    }).toEqual({
      personSpan: [200, ["acme-mem", "acme-fact"]],
      personScoped: [200, ["acme-mem", "acme-fact"]],
      serviceSpan: [
        200,
        [
          "acme-mem",
          "secret-mem",
          "unscoped-mem",
          "acme-fact",
          "secret-fact",
          "unscoped-fact",
        ],
      ],
      personDeniedStatus: 403,
    });
  });

  it("reads GET /user/installations/{installation_id}/repositories to its last page with no cap on the number of repositories", async () => {
    const pages = elevenRepoPages();
    const harness = createHarness({
      installationUserPages: pages.map((repos) => ({ status: 200, repos })),
    });

    seedCatalog(
      harness,
      pages.flat().map((name) => repoRow(name)),
    );

    const token = await signIn(harness.server);
    const lastPage = await callApi(
      harness.server,
      "/api/repos?limit=100&offset=1000",
      token,
    );
    const payload = lastPage.result as {
      total: number;
      repos: Array<{ full_name: string }>;
    };

    expect({
      status: lastPage.statusCode,
      total: payload.total,
      pageCount: harness.installationUserAuthHeaders.length,
      lastPageCount: payload.repos.length,
      firstOnLastPage: payload.repos[0]?.full_name,
      lastOnLastPage: payload.repos.at(-1)?.full_name,
    }).toEqual({
      status: 200,
      total: 1050,
      pageCount: 11,
      lastPageCount: 50,
      firstOnLastPage: "acme/repo-1000",
      lastOnLastPage: "acme/repo-1049",
    });
  });

  it("refuses reads when the list is over five minutes old and a refresh page fails, leaving the previous list intact until every page succeeds", async () => {
    const harness = createHarness({
      userRepos: ["acme/app"],
      installationUserPages: [{ status: 200, repos: ["acme/app"] }],
    });

    seedCatalog(harness, [
      repoRow("acme/app"),
      repoRow("acme/partial-leak"),
      repoRow("acme/refreshed-1"),
      repoRow("acme/refreshed-2"),
    ]);

    const token = await signIn(harness.server);
    const initialRepos = await callApi(harness.server, "/api/repos", token);

    expect(repoFullNamesOf(initialRepos)).toEqual(["acme/app"]);

    vi.setSystemTime(Date.now() + 6 * 60_000);
    harness.setInstallationUserPages([
      { status: 200, repos: ["acme/partial-leak"] },
      { status: 500, repos: [] },
    ]);

    const failedRefreshRes = await callApi(harness.server, "/api/repos", token);
    const storedAfterFailure = harness.storedReposFor(token);

    vi.setSystemTime(Date.now() + 1_000);
    harness.setInstallationUserPages([
      { status: 200, repos: ["acme/refreshed-1"] },
      { status: 200, repos: ["acme/refreshed-2"] },
    ]);

    const recoveredRes = await callApi(harness.server, "/api/repos", token);
    const storedAfterRecovery = harness.storedReposFor(token);

    expect({
      failedOutcome: failedRefreshOutcome(failedRefreshRes),
      storedAfterFailure,
      recovered: [recoveredRes.statusCode, repoFullNamesOf(recoveredRes)],
      storedAfterRecovery,
    }).toEqual({
      failedOutcome: "refused",
      storedAfterFailure: ["acme/app"],
      recovered: [200, ["acme/refreshed-1", "acme/refreshed-2"]],
      storedAfterRecovery: ["acme/refreshed-1", "acme/refreshed-2"],
    });
  });

  it("keeps serving the stored repository list without asking GitHub again while it is under five minutes old", async () => {
    const harness = createHarness({
      userRepos: ["acme/app"],
      installationUserPages: [{ status: 200, repos: ["acme/app"] }],
    });

    seedCatalog(harness, [repoRow("acme/app"), repoRow("acme/changed")]);

    const token = await signIn(harness.server);

    await callApi(harness.server, "/api/repos", token);
    vi.setSystemTime(Date.now() + 4 * 60_000);
    harness.setInstallationUserPages([
      { status: 200, repos: ["acme/changed"] },
    ]);

    const res = await callApi(harness.server, "/api/repos", token);

    expect(repoFullNamesOf(res)).toEqual(["acme/app"]);
    expect(harness.storedReposFor(token)).toEqual(["acme/app"]);
    expect(harness.installationUserAuthHeaders).toEqual([
      `Bearer ${USER_ACCESS_TOKEN}`,
    ]);
  });

  it("refuses a caller with no token or a made-up token with 401 on GET /api/repos/available, GET /api/search-context and GET /api/memory-search", async () => {
    const harness = createHarness({
      installationUserPages: [{ status: 200, repos: ["acme/app"] }],
      appInstallationRepos: ["acme/open"],
    });

    seedCatalog(harness, [repoRow("acme/app")]);
    harness.chunks.push(chunkRow("c-acme", "acme/app", "deploy acme app"));
    harness.memories.push(memoryRow("acme-mem", "acme/app", "memory"));
    const urls = [
      "/api/repos/available",
      "/api/search-context?query=deploy&backend=lore",
      "/api/memory-search?q=cache",
    ];
    const madeUp = await Promise.all(
      urls.map((url) => callApi(harness.server, url, "not-a-real-token")),
    );
    const anonymous = await Promise.all(
      urls.map((url) => harness.server.inject({ method: "GET", url })),
    );

    expect({
      madeUp: madeUp.map((res) => res.statusCode),
      anonymous: anonymous.map((res) => res.statusCode),
      installationReads: harness.installationUserAuthHeaders,
    }).toEqual({
      madeUp: [401, 401, 401],
      anonymous: [401, 401, 401],
      installationReads: [],
    });
  });

  it("shows a person whose installation answer names no repository nothing on GET /api/repos/available, GET /api/search-context and GET /api/memory-search", async () => {
    const harness = createHarness({
      installationUserPages: [{ status: 200, repos: [] }],
      appInstallationRepos: ["acme/open", "other/unonboarded"],
    });

    seedCatalog(harness, [repoRow("other/secret")]);
    harness.chunks.push(
      chunkRow("c-secret", "other/secret", "deploy secret repo"),
      chunkRow("c-none", null, "deploy unscoped note"),
    );
    harness.memories.push(
      memoryRow("secret-mem", "other/secret", "memory"),
      memoryRow("unscoped-fact", null, "fact"),
    );

    const token = await signIn(harness.server);
    const available = await callApi(
      harness.server,
      "/api/repos/available",
      token,
    );
    const search = await callApi(
      harness.server,
      "/api/search-context?query=deploy&backend=lore",
      token,
    );
    const memory = await callApi(
      harness.server,
      "/api/memory-search?q=cache",
      token,
    );

    expect({
      available: [available.statusCode, availableNamesOf(available)],
      search: [search.statusCode, searchContentsOf(search)],
      memory: [memory.statusCode, memoryKeysOf(memory)],
    }).toEqual({ available: [200, []], search: [200, []], memory: [200, []] });
  });

  it("refuses a repository name that climbs out of an allowed repository on GET /api/search-context and GET /api/memory-search", async () => {
    const harness = createHarness({
      installationUserPages: [{ status: 200, repos: ["acme/app"] }],
      utopiaHitsByKb: {
        "kb-secret": [{ path: "docs/deploy.md", text: "secret utopia hit" }],
      },
    });

    seedCatalog(harness, [
      repoRow("acme/app"),
      repoRow("other/secret", {
        settings: {
          utopia: { kb_id: "kb-secret", docs_source_id: "src-docs" },
        },
      }),
    ]);
    harness.memories.push(memoryRow("secret-mem", "other/secret", "memory"));

    const token = await signIn(harness.server);
    const utopiaCalls: string[] = [];
    const stubbedFetch = globalThis.fetch;

    globalThis.fetch = (input, init) => {
      const url = String(input instanceof Request ? input.url : input);

      if (url.startsWith("https://utopia.example.com")) {
        utopiaCalls.push(url);
      }

      return stubbedFetch(input, init);
    };
    const climbing = encodeURIComponent("acme/app/../../other/secret");
    const search = await callApi(
      harness.server,
      `/api/search-context?query=deploy&repo=${climbing}&backend=utopia`,
      token,
    );
    const memory = await callApi(
      harness.server,
      `/api/memory-search?q=cache&repo=${climbing}`,
      token,
    );

    expect({
      searchRefused: [400, 403].includes(search.statusCode),
      memoryRefused: [400, 403].includes(memory.statusCode),
      utopiaCalls,
    }).toEqual({ searchRefused: true, memoryRefused: true, utopiaCalls: [] });
  });
});

function configureEnv(): void {
  process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  process.env.LORE_API_URL = API_URL;
  process.env.LORE_UI_URL = UI_URL;
  process.env.GITHUB_APP_CLIENT_ID = "Iv1.testclient";
  process.env.GITHUB_APP_CLIENT_SECRET = "app-client-secret";
  process.env.GITHUB_APP_INSTALLATION_ID = INSTALLATION_ID;
  process.env.GITHUB_ORG = GITHUB_ORG;
  process.env.LORE_USER_TOKEN_ENCRYPTION_KEY = ENCRYPTION_KEY;
  process.env.GITHUB_TOKEN = "ghs_test_installation";
  process.env.UTOPIA_API_URL = "https://utopia.example.com";
  process.env.UTOPIA_TOKEN = "utopia-test-token";
}

function createHarness(config: GithubRouteConfig) {
  const state: PoolState = {
    repos: [],
    chunks: [],
    memories: [],
    apiTokens: [],
    sessionTokens: [],
    handoffs: new Map(),
  };
  const pool = createFakePool(state);

  setPool(pool as never);
  const server = buildServer(() => pool as never);
  const installationUserAuthHeaders: string[] = [];
  let installationUserPages = [...config.installationUserPages];

  globalThis.fetch = createFetchStub({
    userRepos: config.userRepos ?? [],
    appInstallationRepos: config.appInstallationRepos ?? [],
    utopiaHitsByKb: config.utopiaHitsByKb ?? {},
    getInstallationUserPages: () => installationUserPages,
    recordInstallationUserAuth: (auth) =>
      installationUserAuthHeaders.push(auth),
  });

  return {
    server,
    repos: state.repos,
    chunks: state.chunks,
    memories: state.memories,
    installationUserAuthHeaders,
    setInstallationUserPages: (
      pages: Array<{ status: number; repos: string[] }>,
    ) => {
      installationUserPages = [...pages];
    },
    storedReposFor: (bearerToken: string) =>
      storedReposByToken(state.apiTokens, bearerToken),
  };
}

function storedReposByToken(
  apiTokens: Array<Record<string, unknown>>,
  bearerToken: string,
): string[] {
  const tokenHash = createHash("sha256").update(bearerToken).digest("hex");
  const row = apiTokens.find((entry) => entry.token_hash === tokenHash);

  return (row?.repos as string[] | undefined) ?? [];
}

function seedCatalog(
  harness: { repos: RepoRecord[] },
  entries: RepoRecord[],
): void {
  harness.repos.push(...entries);
}

function repoRow(
  fullName: string,
  overrides: Partial<RepoRecord> = {},
): RepoRecord {
  const [owner, name] = fullName.split("/");

  return {
    id: randomUUID(),
    owner,
    name,
    fullName,
    onboardingPrUrl: null,
    onboardingPrMerged: false,
    onboardedAt: new Date(Date.now()),
    settings: {},
    ...overrides,
  };
}

function chunkRow(
  id: string,
  repo: string | null,
  content: string,
): ChunkRecord {
  return {
    id,
    repo,
    content,
    metadata: { file_path: `docs/${id}.md` },
    rrf_score: 0.9,
  };
}

function memoryRow(
  key: string,
  repo: string | null,
  source: "memory" | "fact" | "episode",
): MemoryRecord {
  return {
    key,
    value: `cache entry for ${key}`,
    agent_id: "agent-1",
    score: 0.9,
    source,
    repo,
  };
}

function elevenRepoPages(): string[][] {
  return Array.from({ length: 11 }, (_, pageIndex) => repoPageNames(pageIndex));
}

function repoPageNames(pageIndex: number): string[] {
  const count = pageIndex === 10 ? 50 : 100;

  return Array.from({ length: count }, (_, offset) => {
    const ordinal = String(pageIndex * 100 + offset).padStart(4, "0");

    return `acme/repo-${ordinal}`;
  });
}

async function signIn(server: ReturnType<typeof buildServer>): Promise<string> {
  const loginRes = await server.inject({
    method: "GET",
    url: `/api/auth/login?return=${encodeURIComponent(`${UI_URL}/inbox`)}`,
  });
  const authorizeUrl = new URL(String(loginRes.headers.location));
  const state = authorizeUrl.searchParams.get("state") ?? "";
  const callbackRes = await server.inject({
    method: "GET",
    url: `/api/auth/callback?code=gh-code&state=${encodeURIComponent(state)}`,
  });
  const redirectUrl = new URL(String(callbackRes.headers.location));
  const code = redirectUrl.searchParams.get("code") ?? "";
  const redeemRes = await server.inject({
    method: "POST",
    url: "/api/auth/redeem",
    payload: { code },
  });

  return (redeemRes.result as { token: string }).token;
}

function callApi(
  server: ReturnType<typeof buildServer>,
  url: string,
  token: string,
) {
  return server.inject({
    method: "GET",
    url,
    headers: { authorization: `Bearer ${token}` },
  });
}

function repoFullNamesOf(res: { result: unknown }): string[] {
  return (res.result as { repos: Array<{ full_name: string }> }).repos.map(
    (repo) => repo.full_name,
  );
}

function availableNamesOf(res: { result: unknown }): string[] {
  return (res.result as Array<{ full_name: string }>).map(
    (repo) => repo.full_name,
  );
}

function inboxReposOf(res: { result: unknown }): string[] {
  return (res.result as { items: Array<{ repo: string }> }).items.map(
    (inboxItem) => inboxItem.repo,
  );
}

function searchContentsOf(res: { result: unknown }): string[] {
  return (res.result as { results: Array<{ content: string }> }).results.map(
    (entry) => entry.content,
  );
}

function memoryKeysOf(res: { result: unknown }): string[] {
  return (res.result as { results: Array<{ key: string }> }).results.map(
    (entry) => entry.key,
  );
}

function failedRefreshOutcome(res: {
  statusCode: number;
  result: unknown;
}): string {
  if (res.statusCode === 200) {
    return `served-stale:${repoFullNamesOf(res).join(",")}`;
  }

  return res.statusCode === 502 || res.statusCode === 503
    ? "refused"
    : `unexpected-status:${res.statusCode}`;
}

interface FetchStubOptions {
  userRepos: string[];
  appInstallationRepos: string[];
  utopiaHitsByKb: Record<string, Array<{ path: string; text: string }>>;
  getInstallationUserPages: () => Array<{ status: number; repos: string[] }>;
  recordInstallationUserAuth: (auth: string) => void;
}

function createFetchStub(options: FetchStubOptions): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.toString());

    if (
      url.hostname === "github.com" &&
      url.pathname === "/login/oauth/access_token"
    ) {
      return jsonResponse({
        access_token: USER_ACCESS_TOKEN,
        token_type: "bearer",
        expires_in: 28_800,
        refresh_token: USER_REFRESH_TOKEN,
        refresh_token_expires_in: 15_811_200,
      });
    }

    if (url.hostname === "api.github.com") {
      return handleGithubApiFetch(url, init, options);
    }

    if (url.hostname === "utopia.example.com") {
      return handleUtopiaFetch(url, options.utopiaHitsByKb);
    }

    return new Response("not found", { status: 404 });
  };
}

function handleGithubApiFetch(
  url: URL,
  init: RequestInit | undefined,
  options: FetchStubOptions,
): Response {
  if (url.pathname === "/user") {
    return jsonResponse({
      id: 1001,
      login: "ada",
      name: "Ada",
      avatar_url: "https://avatars.example/ada.png",
    });
  }

  if (url.pathname === `/user/memberships/orgs/${GITHUB_ORG}`) {
    return jsonResponse({ state: "active", role: "member" });
  }

  if (url.pathname === "/user/repos") {
    return jsonResponse(options.userRepos.map(toGithubRepoJson));
  }

  if (url.pathname === `/user/installations/${INSTALLATION_ID}/repositories`) {
    return respondInstallationUserRepos(url, init, options);
  }

  if (url.pathname === "/installation/repositories") {
    return jsonResponse({
      total_count: options.appInstallationRepos.length,
      repositories: options.appInstallationRepos.map(toGithubRepoJson),
    });
  }

  return new Response("not found", { status: 404 });
}

function respondInstallationUserRepos(
  url: URL,
  init: RequestInit | undefined,
  options: FetchStubOptions,
): Response {
  options.recordInstallationUserAuth(
    headerValue(init?.headers, "authorization"),
  );
  const pageNumber = Number(url.searchParams.get("page") ?? "1");
  const pages = options.getInstallationUserPages();

  return pageResponse(pages, pageNumber);
}

function pageResponse(
  pages: Array<{ status: number; repos: string[] }>,
  pageNumber: number,
): Response {
  const page = pages[pageNumber - 1];

  if (!page || page.status >= 400) {
    return jsonResponse({ message: "upstream error" }, page?.status ?? 500);
  }

  return jsonResponse(
    {
      total_count: countRepoEntries(pages),
      repositories: page.repos.map(toGithubRepoJson),
    },
    200,
    nextPageLinkHeaders(pageNumber, pages.length),
  );
}

function countRepoEntries(
  pages: Array<{ status: number; repos: string[] }>,
): number {
  return pages.reduce((sum, entry) => sum + entry.repos.length, 0);
}

function nextPageLinkHeaders(
  pageNumber: number,
  totalPages: number,
): Record<string, string> {
  if (pageNumber >= totalPages) {
    return {};
  }
  const nextUrl = `https://api.github.com/user/installations/${INSTALLATION_ID}/repositories?per_page=100&page=${pageNumber + 1}`;

  return { Link: `<${nextUrl}>; rel="next"` };
}

function handleUtopiaFetch(
  url: URL,
  utopiaHitsByKb: Record<string, Array<{ path: string; text: string }>>,
): Response {
  const match = /^\/api\/v1\/kbs\/([^/]+)\/search$/.exec(url.pathname);

  if (!match) {
    return new Response("not found", { status: 404 });
  }
  const hits = utopiaHitsByKb[match[1]] ?? [];

  return jsonResponse({
    results: hits.map((hit, index) => ({
      id: `hit-${index}`,
      document_id: `doc-${index}`,
      seq: 0,
      text: hit.text,
      filename: hit.path,
      source_id: "src-docs",
      external_id: `doc:${hit.path}`,
      score: 0.9,
      bm25_rank: 1,
      vector_rank: null,
    })),
    has_more: false,
    vector_used: false,
  });
}

function headerValue(headers: HeadersInit | undefined, name: string): string {
  if (headers instanceof Headers) {
    return headers.get(name) ?? "";
  }
  const target = name.toLowerCase();

  return (
    headerEntries(headers).find(([key]) => key.toLowerCase() === target)?.[1] ??
    ""
  );
}

function headerEntries(
  headers: Exclude<HeadersInit, Headers> | undefined,
): Array<[string, string]> {
  if (!headers) {
    return [];
  }

  return Array.isArray(headers) ? headers : Object.entries(headers);
}

function toGithubRepoJson(fullName: string) {
  const [owner, name] = fullName.split("/");

  return { full_name: fullName, name, owner: { login: owner } };
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

interface PoolState {
  repos: RepoRecord[];
  chunks: ChunkRecord[];
  memories: MemoryRecord[];
  apiTokens: Array<Record<string, unknown>>;
  sessionTokens: Array<Record<string, unknown>>;
  handoffs: Map<string, Record<string, unknown>>;
}

function createFakePool(state: PoolState) {
  const pool = makePool();
  const tx = { active: false, staged: clonePoolState(state) };

  pool.connect.mockImplementation(async () => ({
    query: async (rawSql: string, params: unknown[] = []) =>
      runTxQuery(tx, state, String(rawSql), params),
    release: vi.fn(),
  }));

  pool.query.mockImplementation(
    async (rawSql: string, params: unknown[] = []) =>
      executePoolSql(state, String(rawSql), params),
  );

  return pool;
}

function runTxQuery(
  tx: { active: boolean; staged: PoolState },
  committed: PoolState,
  rawSql: string,
  params: unknown[],
) {
  const trimmed = rawSql.trim();

  if (trimmed === "BEGIN") {
    tx.active = true;
    tx.staged = clonePoolState(committed);

    return { rows: [] };
  }

  if (trimmed === "COMMIT") {
    tx.active = false;
    copyMutableArrays(committed, tx.staged);

    return { rows: [] };
  }

  if (trimmed === "ROLLBACK") {
    tx.active = false;

    return { rows: [] };
  }

  return executePoolSql(tx.active ? tx.staged : committed, rawSql, params);
}

function clonePoolState(source: PoolState): PoolState {
  return {
    repos: source.repos.map((row) => ({ ...row })),
    chunks: source.chunks.map((row) => ({ ...row })),
    memories: source.memories.map((row) => ({ ...row })),
    apiTokens: source.apiTokens.map((row) => ({ ...row })),
    sessionTokens: source.sessionTokens.map((row) => ({ ...row })),
    handoffs: new Map(
      [...source.handoffs.entries()].map(([key, row]) => [key, { ...row }]),
    ),
  };
}

function copyMutableArrays(target: PoolState, source: PoolState): void {
  target.apiTokens.splice(0, target.apiTokens.length, ...source.apiTokens);
  target.sessionTokens.splice(
    0,
    target.sessionTokens.length,
    ...source.sessionTokens,
  );
  target.handoffs.clear();

  for (const [key, row] of source.handoffs.entries()) {
    target.handoffs.set(key, row);
  }
}

const SQL_HANDLERS: Array<{
  matches: (sql: string) => boolean;
  run: (
    state: PoolState,
    sql: string,
    params: unknown[],
  ) => { rows: Array<Record<string, unknown>> };
}> = [
  {
    matches: (sql) =>
      sql.trim() === "SELECT 1" || sql.includes("information_schema.schemata"),
    run: () => ({ rows: [{ ok: 1 }] }),
  },
  {
    matches: (sql) => sql.includes("FROM information_schema.tables"),
    run: () => ({ rows: [{ table_schema: "org_shared" }] }),
  },
  {
    matches: (sql) => sql.includes("lore.login_handoffs"),
    run: (state, sql, params) => handleHandoffSql(state.handoffs, sql, params),
  },
  {
    matches: (sql) => sql.includes("pipeline.api_tokens"),
    run: (state, sql, params) => handleApiTokensSql(state, sql, params),
  },
  {
    matches: (sql) => sql.includes("pipeline.user_session_tokens"),
    run: (state, sql, params) => handleSessionTokensSql(state, sql, params),
  },
  {
    matches: (sql) =>
      sql.includes("lore.repos") || sql.includes("FROM lore.plans"),
    run: (state, sql, params) => handleRepoAndInboxSql(state, sql, params),
  },
  {
    matches: (sql) => sql.includes(".chunks"),
    run: (state, sql, params) => handleChunksSql(state.chunks, sql, params),
  },
  {
    matches: (sql) =>
      sql.includes("memory.memories") || sql.includes("memory.facts"),
    run: (state, sql, params) => handleMemorySql(state.memories, sql, params),
  },
];

function executePoolSql(
  state: PoolState,
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  const matched = SQL_HANDLERS.find((handler) => handler.matches(sql));

  return matched ? matched.run(state, sql, params) : { rows: [] };
}

function handleHandoffSql(
  handoffs: Map<string, Record<string, unknown>>,
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  if (sql.includes("INSERT INTO lore.login_handoffs")) {
    return insertHandoffRow(handoffs, sql, params);
  }

  if (sql.includes("RETURNING")) {
    return takeHandoffRow(handoffs, params);
  }

  return { rows: [] };
}

function insertHandoffRow(
  handoffs: Map<string, Record<string, unknown>>,
  sql: string,
  params: unknown[],
) {
  const columns = insertColumnsOf(sql, "lore.login_handoffs");
  const row = mapColumns(columns, params);

  handoffs.set(String(row.code_hash), row);

  return { rows: [] };
}

function takeHandoffRow(
  handoffs: Map<string, Record<string, unknown>>,
  params: unknown[],
) {
  const codeHash = String(params[0]);
  const phase = String(params[1]);
  const row = handoffs.get(codeHash);

  if (!row || row.phase !== phase) {
    return { rows: [] };
  }
  handoffs.delete(codeHash);

  return {
    rows: [
      {
        returnUrl: row.return_url,
        grant: JSON.parse(String(row.grant_json)),
        encryptedTokens: row.encrypted_tokens,
      },
    ],
  };
}

function handleApiTokensSql(
  state: PoolState,
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  if (sql.includes("INSERT INTO pipeline.api_tokens")) {
    return insertApiTokenRow(state.apiTokens, sql, params);
  }

  if (sql.includes("UPDATE pipeline.api_tokens")) {
    return updateApiTokenRow(state, sql, params);
  }

  const row = findTokenRow(state.apiTokens, sql, params[0]);

  return { rows: row ? [projectTokenRow(state, row)] : [] };
}

function insertApiTokenRow(
  apiTokens: Array<Record<string, unknown>>,
  sql: string,
  params: unknown[],
) {
  const columns = insertColumnsOf(sql, "pipeline.api_tokens");
  const row = mapColumns(columns, params);
  const now = new Date(Date.now());
  const stored: Record<string, unknown> = {
    ...row,
    id: randomUUID(),
    created_at: now,
    repos_refreshed_at: row.repos_refreshed_at ?? now,
    revoked_at: null,
  };

  apiTokens.push(stored);

  return {
    rows: [
      {
        id: stored.id,
        name: stored.name,
        scopes: stored.scopes,
        created_at: now.toISOString(),
      },
    ],
  };
}

function updateApiTokenRow(
  state: PoolState,
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  const row = findTokenRow(state.apiTokens, sql, params[0]);

  if (!row || row.revoked_at !== null) {
    return { rows: [] };
  }

  applyTokenUpdates(row, sql, params);

  return {
    rows: sql.includes("RETURNING") ? [projectTokenRow(state, row)] : [],
  };
}

function applyTokenUpdates(
  row: Record<string, unknown>,
  sql: string,
  params: unknown[],
): void {
  const now = new Date(Date.now());

  if (sql.includes("last_used = now()")) {
    row.last_used = now;
  }

  const reposMatch = /repos\s*=\s*\$(\d+)/i.exec(sql);

  if (reposMatch) {
    row.repos = params[Number(reposMatch[1]) - 1];
  }

  if (sql.includes("repos_refreshed_at = now()")) {
    row.repos_refreshed_at = now;
  }

  const refreshedMatch = /repos_refreshed_at\s*=\s*\$(\d+)/i.exec(sql);

  if (refreshedMatch) {
    row.repos_refreshed_at = params[Number(refreshedMatch[1]) - 1];
  }
}

function findTokenRow(
  apiTokens: Array<Record<string, unknown>>,
  sql: string,
  key: unknown,
): Record<string, unknown> | undefined {
  if (sql.includes("WHERE id = $1")) {
    return apiTokens.find((entry) => entry.id === key);
  }

  return apiTokens.find((entry) => entry.token_hash === key);
}

function projectTokenRow(
  state: PoolState,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const sessionRow = state.sessionTokens.find(
    (entry) => entry.token_id === row.id,
  );
  const refreshedAt = row.repos_refreshed_at ?? row.created_at;
  const encryptedTokens = sessionRow?.encrypted_tokens ?? null;

  return {
    id: row.id,
    scopes: row.scopes,
    kind: row.kind,
    login: row.login,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    repos: row.repos,
    startedAt: row.created_at,
    expiresAt: row.expires_at ?? null,
    reposRefreshedAt: refreshedAt,
    repos_refreshed_at: refreshedAt,
    encryptedTokens,
    encrypted_tokens: encryptedTokens,
  };
}

function handleSessionTokensSql(
  state: PoolState,
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  if (sql.includes("INSERT INTO pipeline.user_session_tokens")) {
    const columns = insertColumnsOf(sql, "pipeline.user_session_tokens");

    state.sessionTokens.push(mapColumns(columns, params));

    return { rows: [] };
  }

  const row = resolveSessionTokenRow(state, sql, params[0]);

  if (!row) {
    return { rows: [] };
  }

  if (sql.includes("UPDATE pipeline.user_session_tokens")) {
    return updateSessionTokenRow(row, sql, params);
  }

  return {
    rows: [
      {
        token_id: row.token_id,
        tokenId: row.token_id,
        encrypted_tokens: row.encrypted_tokens,
        encryptedTokens: row.encrypted_tokens,
      },
    ],
  };
}

function updateSessionTokenRow(
  row: Record<string, unknown>,
  sql: string,
  params: unknown[],
) {
  const encMatch = /encrypted_tokens\s*=\s*\$(\d+)/i.exec(sql);

  if (encMatch) {
    row.encrypted_tokens = params[Number(encMatch[1]) - 1];
  }

  return { rows: [] };
}

function resolveSessionTokenRow(
  state: PoolState,
  sql: string,
  key: unknown,
): Record<string, unknown> | undefined {
  if (sql.includes("token_hash")) {
    const token = state.apiTokens.find((entry) => entry.token_hash === key);

    return token
      ? state.sessionTokens.find((row) => row.token_id === token.id)
      : undefined;
  }

  return state.sessionTokens.find((row) => row.token_id === key);
}

const REPO_SQL_HANDLERS: Array<{
  matches: (sql: string) => boolean;
  run: (
    state: PoolState,
    params: unknown[],
  ) => { rows: Array<Record<string, unknown>> };
}> = [
  {
    matches: (sql) => sql.includes("SELECT team FROM lore.repos"),
    run: () => ({ rows: [{ team: null }] }),
  },
  {
    matches: (sql) => sql.includes("SELECT settings FROM lore.repos"),
    run: (state, params) => {
      const found = state.repos.find((repo) => repo.fullName === params[0]);

      return { rows: found ? [{ settings: found.settings }] : [] };
    },
  },
  {
    matches: (sql) => sql.includes("FROM lore.plans"),
    run: (state, params) => ({
      rows: filterPlanRows(state.repos, params[0] as string[] | null),
    }),
  },
  {
    matches: (sql) => sql.includes("count(*)::int as total"),
    run: (state, params) => ({
      rows: [
        { total: filterRepoList(state.repos, params[0] as string[]).length },
      ],
    }),
  },
  {
    matches: (sql) => sql.includes("onboarding_pr_merged = false"),
    run: (state, params) => ({
      rows: filterOnboardingRows(state.repos, params[0] as string[] | null),
    }),
  },
  {
    matches: (sql) => sql.includes("LIMIT $1 OFFSET $2"),
    run: (state, params) => {
      const limit = Number(params[0]);
      const offset = Number(params[1]);
      const readable = params[2] as string[] | undefined;
      const sliced = filterRepoList(state.repos, readable).slice(
        offset,
        offset + limit,
      );

      return { rows: sliced.map(toRepoWireRow) };
    },
  },
];

function handleRepoAndInboxSql(
  state: PoolState,
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  const matched = REPO_SQL_HANDLERS.find((handler) => handler.matches(sql));

  return matched
    ? matched.run(state, params)
    : { rows: state.repos.map(toRepoWireRow) };
}

function filterRepoList(
  repos: RepoRecord[],
  readable?: string[] | null,
): RepoRecord[] {
  if (!readable) {
    return repos;
  }
  const allowed = new Set(readable.map((name) => name.toLowerCase()));

  return repos.filter((repo) => allowed.has(repo.fullName.toLowerCase()));
}

function filterPlanRows(
  repos: RepoRecord[],
  readable: string[] | null,
): Array<Record<string, unknown>> {
  return filterRepoList(repos, readable).map((repo, index) => ({
    id: `plan-${index}`,
    repo: repo.fullName,
    title: `Review plan for ${repo.fullName}`,
    status: "in-review",
    updated_at: repo.onboardedAt,
  }));
}

function filterOnboardingRows(
  repos: RepoRecord[],
  readable: string[] | null,
): Array<Record<string, unknown>> {
  return filterRepoList(repos, readable)
    .filter((repo) => repo.onboardingPrUrl && !repo.onboardingPrMerged)
    .map((repo) => ({
      id: repo.id,
      full_name: repo.fullName,
      onboarding_pr_url: repo.onboardingPrUrl,
      onboarded_at: repo.onboardedAt,
    }));
}

function toRepoWireRow(repo: RepoRecord): Record<string, unknown> {
  return {
    id: repo.id,
    owner: repo.owner,
    name: repo.name,
    full_name: repo.fullName,
    github_url: `https://github.com/${repo.fullName}`,
    default_branch: "main",
    team: null,
    onboarded_at: repo.onboardedAt,
    onboarding_pr_url: repo.onboardingPrUrl,
    onboarding_pr_merged: repo.onboardingPrMerged,
    settings: repo.settings,
    task_count: 0,
    active_agents: 0,
  };
}

function handleChunksSql(
  chunks: ChunkRecord[],
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  const allowedParam = params.find((param) => Array.isArray(param)) as
    string[] | undefined;

  if (!allowedParam) {
    const repoArg = sql.includes("repo = $3") ? String(params[2]) : null;

    return {
      rows: repoArg
        ? chunks.filter((chunk) => chunk.repo === repoArg)
        : [...chunks],
    };
  }
  const allowed = new Set(allowedParam.map((name) => name.toLowerCase()));

  return {
    rows: chunks.filter(
      (chunk) => chunk.repo && allowed.has(chunk.repo.toLowerCase()),
    ),
  };
}

function handleMemorySql(
  memories: MemoryRecord[],
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  const wantedSource = sql.includes("FROM memory.memories") ? "memory" : "fact";
  const matching = memories.filter((entry) =>
    wantedSource === "memory"
      ? entry.source === "memory"
      : entry.source !== "memory",
  );
  const allowedParam = params.find((param) => Array.isArray(param)) as
    string[] | undefined;

  if (allowedParam) {
    const allowed = new Set(allowedParam.map((name) => name.toLowerCase()));

    return {
      rows: matching.filter(
        (entry) => entry.repo && allowed.has(entry.repo.toLowerCase()),
      ),
    };
  }
  const repoParam = params[1] as string | null | undefined;

  return {
    rows: repoParam
      ? matching.filter(
          (entry) => entry.repo === null || entry.repo === repoParam,
        )
      : matching,
  };
}

function insertColumnsOf(sql: string, tableName: string): string[] {
  const escaped = tableName.replace(".", "\\.");
  const match = new RegExp(
    `INSERT INTO\\s+${escaped}\\s*\\(([^)]+)\\)`,
    "i",
  ).exec(sql);

  return (match?.[1] ?? "").split(",").map((col) => col.trim());
}

function mapColumns(
  columns: string[],
  params: unknown[],
): Record<string, unknown> {
  const record: Record<string, unknown> = {};

  columns.forEach((col, index) => {
    record[col] = params[index];
  });

  return record;
}
