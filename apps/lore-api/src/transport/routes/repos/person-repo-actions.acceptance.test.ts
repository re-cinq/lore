import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LEGACY_TOKEN,
  makePool,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import { setPool } from "@re-cinq/lore-server-core/platform/db.js";
import { useMirrorOwner } from "@re-cinq/lore-shared/floor/floor-client.js";
import { buildServer } from "../../../app/build-server.js";

const API_URL = "https://lore-api.example.com";
const UI_URL = "https://lore-ui.example.com";
const WEBHOOK_URL = "https://lore-events.example.com/api/events";
const WEBHOOK_SECRET = "webhook-hmac-secret";
const FLOOR_URL = "https://floor.example.com";
const GITHUB_ORG = "acme";
const INSTALLATION_ID = "42";
const APP_TOKEN = "ghs_test_installation";
const USER_ACCESS_TOKEN = "ghu_person_repo_actions_access";
const USER_REFRESH_TOKEN = "ghr_person_repo_actions_refresh";
const ENCRYPTION_KEY = randomBytes(32).toString("base64");
const REPO_SECRET_PUBLIC_KEY = randomBytes(32).toString("base64");
const BASE_NOW_MS = new Date("2026-11-22T06:00:00.000Z").getTime();

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = globalThis.fetch;

let nowMs = BASE_NOW_MS;

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

interface RecordedGithubWrite {
  method: string;
  path: string;
  authorization: string;
  body: Record<string, unknown>;
}

interface HarnessConfig {
  installationRepos: string[];
  permissions?: Record<string, "admin" | "write" | "read" | "none">;
}

describe("Person-scoped stored reads, onboarding writes, and pull/issue/webhook/branch/commit writes (FR-031 to FR-297)", () => {
  beforeEach(() => {
    nowMs += 600_000;
    vi.useFakeTimers({ now: nowMs, toFake: ["Date"] });
    configureEnv();
    useMirrorOwner(async () => null);
  });

  afterEach(() => {
    useMirrorOwner(null);
    vi.useRealTimers();
    setPool(null as never);
    globalThis.fetch = ORIGINAL_FETCH;
    process.env = { ...ORIGINAL_ENV };
  });

  it("refuses every read of Lore's stored repository data with 403 when the repository is not in the person's installation list", async () => {
    const harness = createHarness({
      installationRepos: ["acme/app"],
      permissions: {
        "acme/app": "read",
        "other/secret": "read",
      },
    });

    harness.repos.push(repoRow("acme/app"), repoRow("other/secret"));
    const token = await signIn(harness.server);

    harness.sqlCalls.length = 0;
    const denied = await readStoredRepoEndpoints(
      harness.server,
      "other/secret",
      token,
    );
    const leakedSecretQueries = countSecretQueries(harness.sqlCalls);

    advancePastListTtl(harness, ["acme/app"]);
    const afterRefresh = await readStoredRepoEndpoints(
      harness.server,
      "other/secret",
      token,
    );
    const allowed = await readStoredRepoEndpoints(
      harness.server,
      "acme/app",
      token,
    );

    expect({
      deniedRepoStatus: denied[0],
      denied,
      leakedSecretQueryCount: leakedSecretQueries,
      allowed,
      afterRefresh,
    }).toEqual({
      deniedRepoStatus: 403,
      denied: [403, 403, 403, 403],
      leakedSecretQueryCount: 0,
      allowed: [200, 200, 200, 200],
      afterRefresh: [403, 403, 403, 403],
    });
  });

  it("answers allowed false on GET /api/auth/access for a repository outside the person's installation list even when GitHub says admin", async () => {
    const harness = createHarness({
      installationRepos: ["acme/app"],
      permissions: { "acme/app": "read", "other/secret": "admin" },
    });
    const token = await signIn(harness.server);

    const answers = await Promise.all(
      ["other/secret", "acme/app"].map(async (repo) => {
        const res = await harness.server.inject({
          method: "GET",
          url: `/api/auth/access?repo=${encodeURIComponent(repo)}`,
          headers: { authorization: `Bearer ${token}` },
        });

        return { status: res.statusCode, body: res.result };
      }),
    );

    expect(answers).toEqual([
      { status: 200, body: { allowed: false } },
      { status: 200, body: { allowed: true } },
    ]);
  }, 15_000);

  it("refuses a caller with no token or a made-up token with 401 on every stored repository read, querying no stored data", async () => {
    const harness = createHarness({
      installationRepos: ["acme/app"],
      permissions: { "acme/app": "read" },
    });

    harness.repos.push(repoRow("acme/app"));
    harness.sqlCalls.length = 0;

    const anonymous = await readStoredRepoEndpoints(
      harness.server,
      "acme/app",
      null,
    );
    const madeUp = await readStoredRepoEndpoints(
      harness.server,
      "acme/app",
      `lore_${randomBytes(24).toString("hex")}`,
    );

    expect({
      anonymous,
      madeUp,
      storedQueries: harness.sqlCalls.filter((call) =>
        readsStoredRepoData(call.sql),
      ).length,
    }).toEqual({
      anonymous: [401, 401, 401, 401],
      madeUp: [401, 401, 401, 401],
      storedQueries: 0,
    });
  }, 15_000);

  it("refuses stored repository reads named by a letter-case variant or a path that climbs out of a listed repository", async () => {
    const harness = createHarness({
      installationRepos: ["acme/app"],
      permissions: { "acme/app": "read", "other/secret": "read" },
    });

    harness.repos.push(repoRow("acme/app"), repoRow("other/secret"));
    const token = await signIn(harness.server);

    harness.sqlCalls.length = 0;
    const variants = ["Other/Secret", "acme/app/../other/secret"];
    const statuses = await Promise.all(
      variants.map((repo) =>
        readStoredRepoEndpoints(harness.server, repo, token, "query"),
      ),
    );
    const secretQueries = harness.sqlCalls.filter(
      (call) =>
        readsStoredRepoData(call.sql) &&
        call.params.some(
          (param) =>
            typeof param === "string" && param.toLowerCase().includes("secret"),
        ),
    ).length;

    expect({
      refused: statuses
        .flat()
        .every((status) => status === 400 || status === 403),
      secretQueries,
    }).toEqual({ refused: true, secretQueries: 0 });
  }, 15_000);

  it("sets LORE_INGEST_TOKEN, sets LORE_INGEST_URL, and creates the webhook on GitHub with the person's token on POST /api/onboard", async () => {
    const harness = createHarness({
      installationRepos: ["acme/new-repo"],
      permissions: { "acme/new-repo": "admin" },
    });
    const token = await signIn(harness.server);

    const response = await harness.server.inject({
      method: "POST",
      url: "/api/onboard",
      headers: { authorization: `Bearer ${token}` },
      payload: { repo: "acme/new-repo" },
    });

    expect(onboardOutcome(response.statusCode, harness.githubWrites)).toEqual({
      status: 200,
      secretUsesPersonToken: true,
      secretSealedWithRepoKey: true,
      variableUsesPersonToken: true,
      variableValue: API_URL,
      webhookUsesPersonToken: true,
      webhookConfig: {
        url: WEBHOOK_URL,
        content_type: "json",
        secret: WEBHOOK_SECRET,
      },
    });
  }, 15_000);

  it("opens pull requests and files issues on GitHub with the person's token on POST /api/repos/{owner}/{repo}/pulls and POST /api/repos/{owner}/{repo}/issues", async () => {
    const harness = createHarness({
      installationRepos: ["acme/app"],
      permissions: { "acme/app": "write" },
    });
    const token = await signIn(harness.server);

    const pullRes = await harness.server.inject({
      method: "POST",
      url: "/api/repos/acme/app/pulls",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        branch: "feat/person-pr",
        title: "Open PR as person",
        body: "Opened via session",
        base: "main",
        labels: ["enhancement"],
      },
    });
    const issueRes = await harness.server.inject({
      method: "POST",
      url: "/api/repos/acme/app/issues",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        title: "File issue as person",
        body: "Filed via session",
        labels: ["bug"],
      },
    });

    const pullCreate = harness.githubWrites.find(
      (write) =>
        write.method === "POST" && write.path === "/repos/acme/app/pulls",
    );
    const issueCreate = harness.githubWrites.find(
      (write) =>
        write.method === "POST" && write.path === "/repos/acme/app/issues",
    );

    expect({
      pullStatus: pullRes.statusCode,
      issueStatus: issueRes.statusCode,
      pullUsesPersonToken: Boolean(
        pullCreate && isUserAuth(pullCreate.authorization),
      ),
      issueUsesPersonToken: Boolean(
        issueCreate && isUserAuth(issueCreate.authorization),
      ),
    }).toEqual({
      pullStatus: 200,
      issueStatus: 200,
      pullUsesPersonToken: true,
      issueUsesPersonToken: true,
    });
  }, 15_000);

  it("refuses POST pulls and POST issues with 401 for a caller with no token or a made-up token, writing nothing on GitHub", async () => {
    const harness = createHarness({
      installationRepos: ["acme/app"],
      permissions: { "acme/app": "write" },
    });
    const madeUp = `lore_${randomBytes(24).toString("hex")}`;

    const statuses = await postPullAndIssue(harness.server, "acme/app", null);
    const madeUpStatuses = await postPullAndIssue(
      harness.server,
      "acme/app",
      madeUp,
    );

    expect({
      anonymous: statuses,
      madeUp: madeUpStatuses,
      githubWrites: harness.githubWrites.length,
    }).toEqual({ anonymous: [401, 401], madeUp: [401, 401], githubWrites: 0 });
  }, 15_000);

  it("refuses POST pulls and POST issues with 403 on a repository outside the person's installation list, writing nothing on GitHub", async () => {
    const harness = createHarness({
      installationRepos: ["acme/app"],
      permissions: { "acme/app": "write", "other/secret": "admin" },
    });
    const token = await signIn(harness.server);

    const statuses = await postPullAndIssue(
      harness.server,
      "other/secret",
      token,
    );

    expect({
      statuses,
      githubWrites: harness.githubWrites.length,
    }).toEqual({ statuses: [403, 403], githubWrites: 0 });
  }, 15_000);

  it("refuses POST pulls and POST issues when the person's stored GitHub token cannot be read, never acting with the App's token", async () => {
    const harness = createHarness({
      installationRepos: ["acme/app"],
      permissions: { "acme/app": "write" },
    });
    const token = await signIn(harness.server);

    delete process.env.LORE_USER_TOKEN_ENCRYPTION_KEY;
    const statuses = await postPullAndIssue(harness.server, "acme/app", token);

    expect({
      statuses,
      githubWrites: harness.githubWrites.length,
    }).toEqual({ statuses: [500, 500], githubWrites: 0 });
  }, 15_000);

  it("refuses POST /api/onboard with 403 for a repository outside the person's installation list, writing nothing on GitHub", async () => {
    const harness = createHarness({
      installationRepos: ["acme/app"],
      permissions: { "acme/app": "admin", "other/secret": "admin" },
    });
    const token = await signIn(harness.server);

    const response = await harness.server.inject({
      method: "POST",
      url: "/api/onboard",
      headers: { authorization: `Bearer ${token}` },
      payload: { repo: "other/secret" },
    });

    expect({
      status: response.statusCode,
      githubWrites: harness.githubWrites.length,
    }).toEqual({ status: 403, githubWrites: 0 });
  }, 15_000);

  it("refuses POST /api/onboard when the person's stored GitHub token cannot be read, setting no secret, variable or webhook with the App's token", async () => {
    const harness = createHarness({
      installationRepos: ["acme/new-repo"],
      permissions: { "acme/new-repo": "admin" },
    });
    const token = await signIn(harness.server);

    delete process.env.LORE_USER_TOKEN_ENCRYPTION_KEY;
    const response = await harness.server.inject({
      method: "POST",
      url: "/api/onboard",
      headers: { authorization: `Bearer ${token}` },
      payload: { repo: "acme/new-repo" },
    });

    expect({
      status: response.statusCode,
      githubWrites: harness.githubWrites.length,
    }).toEqual({ status: 500, githubWrites: 0 });
  }, 15_000);

  it("makes the change with the person's token on POST webhook/ensure, POST branches, POST commit, POST sub-issues and PATCH issues", async () => {
    const harness = createHarness({
      installationRepos: ["acme/app"],
      permissions: { "acme/app": "admin" },
    });
    const token = await signIn(harness.server);

    const outcomes = await callEveryChangeRoute(harness, token);

    expect(outcomes).toEqual(
      CHANGE_ROUTES.map(({ githubWrite }) => ({
        status: 200,
        githubWrite,
        actor: "person",
      })),
    );
  }, 15_000);

  it("refuses POST webhook/ensure, POST branches, POST commit, POST sub-issues and PATCH issues with 500 when the person's stored GitHub token cannot be read, writing nothing on GitHub", async () => {
    const harness = createHarness({
      installationRepos: ["acme/app"],
      permissions: { "acme/app": "admin" },
    });
    const token = await signIn(harness.server);

    delete process.env.LORE_USER_TOKEN_ENCRYPTION_KEY;
    const outcomes = await callEveryChangeRoute(harness, token);

    expect({
      statuses: outcomes.map((outcome) => outcome.status),
      githubWrites: harness.githubWrites.length,
    }).toEqual({
      statuses: CHANGE_ROUTES.map(() => 500),
      githubWrites: 0,
    });
  }, 15_000);

  it("refuses POST webhook/ensure, POST branches, POST commit, POST sub-issues and PATCH issues with 403 on a repository outside the person's installation list, writing nothing on GitHub", async () => {
    const harness = createHarness({
      installationRepos: ["acme/app"],
      permissions: { "acme/app": "write", "other/secret": "admin" },
    });
    const token = await signIn(harness.server);

    const outcomes = await callEveryChangeRoute(harness, token, "other/secret");

    expect({
      statuses: outcomes.map((outcome) => outcome.status),
      githubWrites: harness.githubWrites.length,
    }).toEqual({
      statuses: CHANGE_ROUTES.map(() => 403),
      githubWrites: 0,
    });
  }, 15_000);

  it("cuts the onboarding branch on GitHub with the person's token on POST /api/onboard", async () => {
    const harness = createHarness({
      installationRepos: ["acme/new-repo"],
      permissions: { "acme/new-repo": "admin" },
    });
    const token = await signIn(harness.server);

    const response = await harness.server.inject({
      method: "POST",
      url: "/api/onboard",
      headers: { authorization: `Bearer ${token}` },
      payload: { repo: "acme/new-repo" },
    });

    expect({
      status: response.statusCode,
      branchWrites: harness.githubWrites
        .filter((write) => write.path.endsWith("/git/refs"))
        .map((write) => ({
          path: write.path,
          actor: actorOf(write.authorization),
        })),
    }).toEqual({
      status: 200,
      branchWrites: [
        { path: "/repos/acme/new-repo/git/refs", actor: "person" },
      ],
    });
  }, 15_000);

  it("makes the change as the App on POST webhook/ensure, POST branches, POST commit, POST sub-issues and PATCH issues when called with the wide service token", async () => {
    const harness = createHarness({
      installationRepos: ["acme/app"],
      permissions: { "acme/app": "write" },
    });

    const outcomes = await callEveryChangeRoute(harness, LEGACY_TOKEN);

    expect(outcomes).toEqual(
      CHANGE_ROUTES.map(({ githubWrite }) => ({
        status: 200,
        githubWrite,
        actor: "app",
      })),
    );
  }, 15_000);

  it("makes the change as the App, not with any person's token, on POST webhook/ensure, POST branches, POST commit, POST sub-issues and PATCH issues when called with a token a person minted", async () => {
    const harness = createHarness({
      installationRepos: ["acme/app"],
      permissions: { "acme/app": "write" },
    });
    const sessionToken = await signIn(harness.server);
    const mintRes = await harness.server.inject({
      method: "POST",
      url: "/api/tokens",
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: { name: "person-ci", scopes: ["write"] },
    });
    const mintedToken = (mintRes.result as { token: string }).token;

    const outcomes = await callEveryChangeRoute(harness, mintedToken);

    expect(outcomes).toEqual(
      CHANGE_ROUTES.map(({ githubWrite }) => ({
        status: 200,
        githubWrite,
        actor: "app",
      })),
    );
  }, 15_000);
});

const CHANGE_ROUTES = [
  {
    method: "POST",
    path: "webhook/ensure",
    payload: {},
    githubWrite: "POST /repos/acme/app/hooks",
  },
  {
    method: "POST",
    path: "branches",
    payload: { branch: "feat/x", base: "main" },
    githubWrite: "POST /repos/acme/app/git/refs",
  },
  {
    method: "POST",
    path: "commit",
    payload: {
      branch: "feat/x",
      path: "docs/a.md",
      content: "hello",
      message: "add a",
    },
    githubWrite: "PUT /repos/acme/app/contents/docs%2Fa.md",
  },
  {
    method: "POST",
    path: "issues/7/sub-issues",
    payload: { child: 8 },
    githubWrite: "POST /repos/acme/app/issues/7/sub_issues",
  },
  {
    method: "PATCH",
    path: "issues/7",
    payload: { title: "new title" },
    githubWrite: "PATCH /repos/acme/app/issues/7",
  },
];

async function callEveryChangeRoute(
  harness: ReturnType<typeof createHarness>,
  token: string,
  repo = "acme/app",
) {
  const outcomes = [];

  for (const route of CHANGE_ROUTES) {
    vi.setSystemTime((nowMs += 10_000));
    const before = harness.githubWrites.length;
    const response = await harness.server.inject({
      method: route.method as "POST" | "PATCH",
      url: `/api/repos/${repo}/${route.path}`,
      headers: { authorization: `Bearer ${token}` },
      payload: route.payload,
    });
    const write = harness.githubWrites.slice(before)[0];

    outcomes.push({
      status: response.statusCode,
      githubWrite: write ? `${write.method} ${write.path}` : "",
      actor: write ? actorOf(write.authorization) : "none",
    });
  }

  return outcomes;
}

function actorOf(authorization: string): "person" | "app" | "other" {
  if (isUserAuth(authorization)) {
    return "person";
  }

  return authorization.includes(APP_TOKEN) ? "app" : "other";
}

async function postPullAndIssue(
  server: ReturnType<typeof buildServer>,
  repo: string,
  token: string | null,
): Promise<number[]> {
  const headers: Record<string, string> =
    token === null ? {} : { authorization: `Bearer ${token}` };
  const pull = await server.inject({
    method: "POST",
    url: `/api/repos/${repo}/pulls`,
    headers,
    payload: { branch: "feat/x", title: "t", body: "b", base: "main" },
  });
  const issue = await server.inject({
    method: "POST",
    url: `/api/repos/${repo}/issues`,
    headers,
    payload: { title: "t", body: "b" },
  });

  return [pull.statusCode, issue.statusCode];
}

function configureEnv(): void {
  process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  process.env.LORE_INGEST_URL = API_URL;
  process.env.LORE_API_URL = API_URL;
  process.env.LORE_UI_URL = UI_URL;
  process.env.LORE_WEBHOOK_URL = WEBHOOK_URL;
  process.env.LORE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.FLOOR_API_URL = FLOOR_URL;
  process.env.FLOOR_SERVICE_TOKEN = "floor-service-token";
  process.env.GITHUB_APP_CLIENT_ID = "Iv1.testclient";
  process.env.GITHUB_APP_CLIENT_SECRET = "app-client-secret";
  process.env.GITHUB_APP_INSTALLATION_ID = INSTALLATION_ID;
  process.env.GITHUB_ORG = GITHUB_ORG;
  process.env.LORE_USER_TOKEN_ENCRYPTION_KEY = ENCRYPTION_KEY;
  process.env.GITHUB_TOKEN = APP_TOKEN;
}

function createHarness(config: HarnessConfig) {
  const state = {
    repos: [] as RepoRecord[],
    apiTokens: [] as Array<Record<string, unknown>>,
    sessionTokens: [] as Array<Record<string, unknown>>,
    handoffs: new Map<string, Record<string, unknown>>(),
  };
  const sqlCalls: Array<{ sql: string; params: unknown[] }> = [];
  const githubWrites: RecordedGithubWrite[] = [];
  const pool = createFakePool(state, sqlCalls);
  let installationRepos = [...config.installationRepos];

  setPool(pool as never);
  const server = buildServer(() => pool as never);

  globalThis.fetch = createFetchStub({
    getInstallationRepos: () => installationRepos,
    permissions: config.permissions ?? {},
    githubWrites,
  });

  return {
    server,
    repos: state.repos,
    sqlCalls,
    githubWrites,
    setInstallationRepos: (repos: string[]) => {
      installationRepos = [...repos];
    },
  };
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

async function readStoredRepoEndpoints(
  server: ReturnType<typeof buildServer>,
  repo: string,
  token: string | null,
  only: "all" | "query" = "all",
): Promise<number[]> {
  const pathUrls = only === "all" ? [`/api/repos/${repo}`] : [];
  const urls = [
    ...pathUrls,
    `/api/chunks?repo=${encodeURIComponent(repo)}`,
    `/api/repo-status?repo=${encodeURIComponent(repo)}`,
    `/api/context?repo=${encodeURIComponent(repo)}&query=deploy&backend=lore`,
  ];
  const responses = await Promise.all(
    urls.map((url) =>
      server.inject({
        method: "GET",
        url,
        headers: token === null ? {} : { authorization: `Bearer ${token}` },
      }),
    ),
  );

  return responses.map((res) => res.statusCode);
}

function onboardOutcome(status: number, githubWrites: RecordedGithubWrite[]) {
  const secretPut = githubWrites.find(
    (write) =>
      write.method === "PUT" &&
      write.path === "/repos/acme/new-repo/actions/secrets/LORE_INGEST_TOKEN",
  );
  const variableWrite = githubWrites.find(
    (write) =>
      write.path.startsWith("/repos/acme/new-repo/actions/variables") &&
      isVariableNamed(write, "LORE_INGEST_URL"),
  );
  const hookCreate = githubWrites.find(
    (write) =>
      write.method === "POST" && write.path === "/repos/acme/new-repo/hooks",
  );

  return {
    status,
    secretUsesPersonToken: Boolean(
      secretPut && isUserAuth(secretPut.authorization),
    ),
    secretSealedWithRepoKey: isSealedSecret(secretPut),
    variableUsesPersonToken: Boolean(
      variableWrite && isUserAuth(variableWrite.authorization),
    ),
    variableValue: variableWrite?.body.value,
    webhookUsesPersonToken: Boolean(
      hookCreate && isUserAuth(hookCreate.authorization),
    ),
    webhookConfig: hookCreate?.body.config,
  };
}

function isSealedSecret(secretPut: RecordedGithubWrite | undefined): boolean {
  if (!secretPut || secretPut.body.key_id !== "key-1") {
    return false;
  }
  const encrypted = secretPut.body.encrypted_value;

  return typeof encrypted === "string" && encrypted !== LEGACY_TOKEN;
}

function countSecretQueries(
  sqlCalls: Array<{ sql: string; params: unknown[] }>,
): number {
  return sqlCalls.filter(
    (call) =>
      call.params.includes("other/secret") && readsStoredRepoData(call.sql),
  ).length;
}

function advancePastListTtl(
  harness: ReturnType<typeof createHarness>,
  repos: string[],
): void {
  harness.setInstallationRepos(repos);
  nowMs += 5 * 60_000 + 1_000;
  vi.advanceTimersByTime(5 * 60_000 + 1_000);
}

function readsStoredRepoData(sql: string): boolean {
  return sql.includes("lore.repos") || sql.includes(".chunks");
}

function isUserAuth(authorization: string): boolean {
  const carriesUser = authorization.includes(USER_ACCESS_TOKEN);
  const carriesApp = authorization.includes(APP_TOKEN);

  return carriesUser && !carriesApp;
}

function isVariableNamed(write: RecordedGithubWrite, name: string): boolean {
  if (write.method === "POST" && write.body.name === name) {
    return true;
  }

  return write.method === "PATCH" && write.path.endsWith(`/${name}`);
}

function repoRow(fullName: string): RepoRecord {
  const [owner, name] = fullName.split("/");

  return {
    id: randomUUID(),
    owner,
    name,
    fullName,
    onboardingPrUrl: null,
    onboardingPrMerged: false,
    onboardedAt: new Date(Date.now()),
    settings: { context_backend: "lore" },
  };
}

function createFetchStub(options: {
  getInstallationRepos: () => string[];
  permissions: Record<string, "admin" | "write" | "read" | "none">;
  githubWrites: RecordedGithubWrite[];
}): typeof fetch {
  return async (input, init) => {
    const request = await resolveFetchRequest(input, init);
    const url = new URL(request.url);

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
      return handleGithubApiFetch(url, request, options);
    }

    if (url.hostname === "floor.example.com") {
      return handleFloorFetch(url);
    }

    return new Response("not found", { status: 404 });
  };
}

async function resolveFetchRequest(
  input: string | URL | Request,
  init: RequestInit | undefined,
): Promise<{
  url: string;
  method: string;
  authorization: string;
  bodyText: string;
}> {
  if (input instanceof Request) {
    return requestFromInstance(input, init);
  }

  return requestFromInit(input, init);
}

function requestFromInit(input: string | URL, init: RequestInit | undefined) {
  return {
    url: input.toString(),
    method: (init?.method ?? "GET").toUpperCase(),
    authorization: headerValue(init?.headers, "authorization"),
    bodyText: typeof init?.body === "string" ? init.body : "",
  };
}

async function requestFromInstance(
  input: Request,
  init: RequestInit | undefined,
) {
  const bodyText = await input.clone().text();
  const authorization =
    headerValue(init?.headers, "authorization") ||
    input.headers.get("authorization") ||
    "";

  return {
    url: input.url,
    method: (init?.method ?? input.method).toUpperCase(),
    authorization,
    bodyText,
  };
}

function handleGithubApiFetch(
  url: URL,
  request: { method: string; authorization: string; bodyText: string },
  options: {
    getInstallationRepos: () => string[];
    permissions: Record<string, "admin" | "write" | "read" | "none">;
    githubWrites: RecordedGithubWrite[];
  },
): Response {
  const identityReply = handleIdentityFetch(
    url,
    options.getInstallationRepos(),
  );

  if (identityReply) {
    return identityReply;
  }

  const permissionMatch =
    /^\/repos\/([^/]+\/[^/]+)\/collaborators\/[^/]+\/permission$/.exec(
      url.pathname,
    );

  if (permissionMatch && request.method === "GET") {
    const level = options.permissions[permissionMatch[1]] ?? "none";

    return jsonResponse({ permission: level });
  }

  return handleGithubRepoOpsFetch(url, request, options.githubWrites);
}

function handleIdentityFetch(
  url: URL,
  installationRepos: string[],
): Response | null {
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

  if (url.pathname === `/user/installations/${INSTALLATION_ID}/repositories`) {
    return jsonResponse({
      total_count: installationRepos.length,
      repositories: installationRepos.map(toGithubRepoJson),
    });
  }

  return null;
}

function handleGithubRepoOpsFetch(
  url: URL,
  request: { method: string; authorization: string; bodyText: string },
  githubWrites: RecordedGithubWrite[],
): Response {
  const onboardingReply = handleOnboardingGithubFetch(
    url,
    request,
    githubWrites,
  );

  if (onboardingReply) {
    return onboardingReply;
  }

  return (
    handleChangeFetch(url, request, githubWrites) ??
    handlePullAndIssueFetch(url, request, githubWrites)
  );
}

function handleChangeFetch(
  url: URL,
  request: { method: string; authorization: string; bodyText: string },
  githubWrites: RecordedGithubWrite[],
): Response | null {
  const key = `${request.method} ${url.pathname}`;

  if (/^GET \/repos\/[^/]+\/[^/]+\/issues\/\d+$/.test(key)) {
    return jsonResponse({ id: 5008, number: 8 });
  }

  if (
    /^(PUT \/repos\/[^/]+\/[^/]+\/contents\/.+|PATCH \/repos\/[^/]+\/[^/]+\/issues\/\d+|POST \/repos\/[^/]+\/[^/]+\/issues\/\d+\/sub_issues)$/.test(
      key,
    )
  ) {
    recordWrite(githubWrites, request, url.pathname);

    return jsonResponse({ number: 7, content: { sha: "c0ffee" } }, 200);
  }

  return null;
}

function handleOnboardingGithubFetch(
  url: URL,
  request: { method: string; authorization: string; bodyText: string },
  githubWrites: RecordedGithubWrite[],
): Response | null {
  const secretReply = handleSecretOrVariableFetch(url, request, githubWrites);

  if (secretReply) {
    return secretReply;
  }

  return handleHookAndBranchFetch(url, request, githubWrites);
}

function handleSecretOrVariableFetch(
  url: URL,
  request: { method: string; authorization: string; bodyText: string },
  githubWrites: RecordedGithubWrite[],
): Response | null {
  const key = `${request.method} ${url.pathname}`;

  if (/^GET \/repos\/[^/]+\/[^/]+\/actions\/secrets\/public-key$/.test(key)) {
    return jsonResponse({ key_id: "key-1", key: REPO_SECRET_PUBLIC_KEY });
  }

  if (/^PUT \/repos\/[^/]+\/[^/]+\/actions\/secrets\/[^/]+$/.test(key)) {
    recordWrite(githubWrites, request, url.pathname);

    return new Response(null, { status: 204 });
  }

  if (/^PATCH \/repos\/[^/]+\/[^/]+\/actions\/variables\/[^/]+$/.test(key)) {
    return new Response("not found", { status: 404 });
  }

  if (/^POST \/repos\/[^/]+\/[^/]+\/actions\/variables$/.test(key)) {
    recordWrite(githubWrites, request, url.pathname);

    return new Response(null, { status: 201 });
  }

  return null;
}

function handleHookAndBranchFetch(
  url: URL,
  request: { method: string; authorization: string; bodyText: string },
  githubWrites: RecordedGithubWrite[],
): Response | null {
  const hookReply = handleHookFetch(url, request, githubWrites);

  if (hookReply) {
    return hookReply;
  }

  return handleBranchFetch(url, request, githubWrites);
}

function handleHookFetch(
  url: URL,
  request: { method: string; authorization: string; bodyText: string },
  githubWrites: RecordedGithubWrite[],
): Response | null {
  const key = `${request.method} ${url.pathname}`;

  if (/^GET \/repos\/[^/]+\/[^/]+\/hooks$/.test(key)) {
    return jsonResponse([]);
  }

  if (/^POST \/repos\/[^/]+\/[^/]+\/hooks$/.test(key)) {
    recordWrite(githubWrites, request, url.pathname);

    return jsonResponse({ id: 77, active: true }, 201);
  }

  if (/^POST \/repos\/[^/]+\/[^/]+\/hooks\/\d+\/pings$/.test(key)) {
    return new Response(null, { status: 204 });
  }

  return null;
}

function handleBranchFetch(
  url: URL,
  request: { method: string; authorization: string; bodyText: string },
  githubWrites: RecordedGithubWrite[],
): Response | null {
  const key = `${request.method} ${decodeURIComponent(url.pathname)}`;

  if (/^GET \/repos\/[^/]+\/[^/]+$/.test(key)) {
    return jsonResponse({ default_branch: "main" });
  }

  if (/^GET \/repos\/[^/]+\/[^/]+\/git\/ref\/heads\/main$/.test(key)) {
    return jsonResponse({ object: { sha: "abc123" } });
  }

  if (/^POST \/repos\/[^/]+\/[^/]+\/git\/refs$/.test(key)) {
    recordWrite(githubWrites, request, url.pathname);

    return jsonResponse({ ref: "refs/heads/lore/onboard/task-1" }, 201);
  }

  return null;
}

function handlePullAndIssueFetch(
  url: URL,
  request: { method: string; authorization: string; bodyText: string },
  githubWrites: RecordedGithubWrite[],
): Response {
  const pullReply = handlePullFetch(url, request, githubWrites);

  if (pullReply) {
    return pullReply;
  }

  return handleIssueFetch(url, request, githubWrites);
}

function handlePullFetch(
  url: URL,
  request: { method: string; authorization: string; bodyText: string },
  githubWrites: RecordedGithubWrite[],
): Response | null {
  if (request.method !== "POST") {
    return null;
  }
  const pullMatch = /^\/repos\/([^/]+\/[^/]+)\/pulls$/.exec(url.pathname);

  if (!pullMatch) {
    return null;
  }
  recordWrite(githubWrites, request, url.pathname);

  return jsonResponse(
    {
      number: 42,
      title: "Open PR as person",
      html_url: `https://github.com/${pullMatch[1]}/pull/42`,
      head: { ref: "feat/person-pr" },
      state: "open",
      user: { login: "ada" },
      labels: [],
      draft: false,
    },
    201,
  );
}

function handleIssueFetch(
  url: URL,
  request: { method: string; authorization: string; bodyText: string },
  githubWrites: RecordedGithubWrite[],
): Response {
  if (request.method !== "POST") {
    return new Response("not found", { status: 404 });
  }

  if (/^\/repos\/[^/]+\/[^/]+\/issues\/\d+\/labels$/.test(url.pathname)) {
    recordWrite(githubWrites, request, url.pathname);

    return jsonResponse([{ name: "enhancement" }]);
  }
  const issueMatch = /^\/repos\/([^/]+\/[^/]+)\/issues$/.exec(url.pathname);

  if (!issueMatch) {
    return new Response("not found", { status: 404 });
  }
  recordWrite(githubWrites, request, url.pathname);

  return jsonResponse(
    {
      number: 99,
      title: "File issue as person",
      state: "open",
      html_url: `https://github.com/${issueMatch[1]}/issues/99`,
      labels: [{ name: "bug" }],
    },
    201,
  );
}

function handleFloorFetch(url: URL): Response {
  if (url.pathname === "/blobs") {
    return jsonResponse({ hash: `sha256-${"a".repeat(64)}` }, 201);
  }

  if (url.pathname === "/assembly-lines/onboard/start") {
    return jsonResponse({ run: { id: "run-1" } }, 201);
  }

  return new Response("not found", { status: 404 });
}

function recordWrite(
  githubWrites: RecordedGithubWrite[],
  request: { method: string; authorization: string; bodyText: string },
  path: string,
): void {
  const body = request.bodyText
    ? (JSON.parse(request.bodyText) as Record<string, unknown>)
    : {};

  githubWrites.push({
    method: request.method,
    path,
    authorization: request.authorization,
    body,
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
  apiTokens: Array<Record<string, unknown>>;
  sessionTokens: Array<Record<string, unknown>>;
  handoffs: Map<string, Record<string, unknown>>;
}

function createFakePool(
  state: PoolState,
  sqlCalls: Array<{ sql: string; params: unknown[] }>,
) {
  const pool = makePool();
  const tx = { active: false, staged: clonePoolState(state) };

  pool.connect.mockImplementation(async () => ({
    query: async (rawSql: string, params: unknown[] = []) => {
      const sql = String(rawSql);

      sqlCalls.push({ sql, params });

      return runTxQuery(tx, state, sql, params);
    },
    release: vi.fn(),
  }));

  pool.query.mockImplementation(
    async (rawSql: string, params: unknown[] = []) => {
      const sql = String(rawSql);

      sqlCalls.push({ sql, params });

      return executePoolSql(state, sql, params);
    },
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
    apiTokens: source.apiTokens.map((row) => ({ ...row })),
    sessionTokens: source.sessionTokens.map((row) => ({ ...row })),
    handoffs: new Map(
      [...source.handoffs.entries()].map(([key, row]) => [key, { ...row }]),
    ),
  };
}

function copyMutableArrays(target: PoolState, source: PoolState): void {
  target.repos.splice(0, target.repos.length, ...source.repos);
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

const POOL_SQL_HANDLERS: Array<{
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
    matches: (sql) => sql.includes("pipeline.tasks"),
    run: (_state, sql) => handleTasksSql(sql),
  },
  {
    matches: (sql) => sql.includes("lore.repos"),
    run: (state, sql, params) => handleReposSql(state.repos, sql, params),
  },
];

function executePoolSql(
  state: PoolState,
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  const handler = POOL_SQL_HANDLERS.find((entry) => entry.matches(sql));

  return handler ? handler.run(state, sql, params) : { rows: [] };
}

function handleHandoffSql(
  handoffs: Map<string, Record<string, unknown>>,
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  if (sql.includes("INSERT INTO lore.login_handoffs")) {
    return insertHandoff(handoffs, sql, params);
  }

  return sql.includes("RETURNING")
    ? claimHandoff(handoffs, params)
    : { rows: [] };
}

function insertHandoff(
  handoffs: Map<string, Record<string, unknown>>,
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  const columns = insertColumnsOf(sql, "lore.login_handoffs");
  const row = mapColumns(columns, params);

  handoffs.set(String(row.code_hash), row);

  return { rows: [] };
}

function claimHandoff(
  handoffs: Map<string, Record<string, unknown>>,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  const row = handoffs.get(String(params[0]));

  if (!row || row.phase !== String(params[1])) {
    return { rows: [] };
  }
  handoffs.delete(String(params[0]));

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
    return insertApiToken(state, sql, params);
  }

  if (sql.includes("UPDATE pipeline.api_tokens")) {
    return updateApiTokenRow(state, sql, params);
  }

  const row = state.apiTokens.find((entry) => entry.token_hash === params[0]);

  return { rows: row ? [projectTokenRow(state, row)] : [] };
}

function insertApiToken(
  state: PoolState,
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
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

  state.apiTokens.push(stored);

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
  const row = sql.includes("WHERE id = $1")
    ? state.apiTokens.find((entry) => entry.id === params[0])
    : state.apiTokens.find((entry) => entry.token_hash === params[0]);

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

  if (sql.includes("repos = array_append")) {
    const existing = (row.repos as string[] | undefined) ?? [];

    row.repos = [...existing, String(params[1])];
  }
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
    github_id: row.github_id,
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

  const row = state.sessionTokens.find((entry) => entry.token_id === params[0]);

  return {
    rows: row
      ? [
          {
            token_id: row.token_id,
            tokenId: row.token_id,
            encrypted_tokens: row.encrypted_tokens,
            encryptedTokens: row.encrypted_tokens,
          },
        ]
      : [],
  };
}

function handleTasksSql(sql: string): {
  rows: Array<Record<string, unknown>>;
} {
  if (sql.includes("INSERT INTO pipeline.tasks")) {
    return {
      rows: [
        {
          id: "task-1",
          task_type: "onboard",
          status: "pending",
          priority: "normal",
          created_at: new Date(Date.now()).toISOString(),
        },
      ],
    };
  }

  if (sql.includes("UPDATE pipeline.tasks")) {
    return { rows: [{ id: "task-1" }] };
  }

  return { rows: [] };
}

const REPO_SQL_HANDLERS: Array<{
  matches: (sql: string) => boolean;
  run: (
    repos: RepoRecord[],
    params: unknown[],
  ) => { rows: Array<Record<string, unknown>> };
}> = [
  {
    matches: (sql) => sql.includes("INSERT INTO lore.repos"),
    run: (repos, params) => upsertRepoRow(repos, String(params[2])),
  },
  {
    matches: (sql) => sql.includes("SELECT team FROM lore.repos"),
    run: () => ({ rows: [{ team: null }] }),
  },
  {
    matches: (sql) => sql.includes("SELECT settings FROM lore.repos"),
    run: (repos, params) => {
      const found = repos.find((repo) => repo.fullName === params[0]);

      return { rows: found ? [{ settings: found.settings }] : [] };
    },
  },
  {
    matches: (sql) =>
      sql.includes("SELECT settings, last_ingested_at FROM lore.repos"),
    run: (repos, params) => {
      const found = repos.find((repo) => repo.fullName === params[0]);

      return {
        rows: found
          ? [{ settings: found.settings, last_ingested_at: null }]
          : [],
      };
    },
  },
  {
    matches: (sql) => sql.includes("onboarding_pr_merged"),
    run: (repos, params) => {
      const found = repos.find((repo) => repo.fullName === params[0]);

      return {
        rows: found
          ? [
              {
                onboarding_pr_merged: found.onboardingPrMerged,
                onboarding_pr_url: found.onboardingPrUrl,
              },
            ]
          : [],
      };
    },
  },
];

function handleReposSql(
  repos: RepoRecord[],
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  const handler = REPO_SQL_HANDLERS.find((entry) => entry.matches(sql));

  if (handler) {
    return handler.run(repos, params);
  }
  const found = repos.find((repo) => repo.fullName === params[0]);

  return { rows: found ? [toRepoRow(found)] : [] };
}

function upsertRepoRow(
  repos: RepoRecord[],
  fullName: string,
): { rows: Array<Record<string, unknown>> } {
  const existing = repos.find((repo) => repo.fullName === fullName);

  if (existing) {
    return { rows: [{ id: existing.id }] };
  }
  const added = repoRow(fullName);

  repos.push(added);

  return { rows: [{ id: added.id }] };
}

function toRepoRow(repo: RepoRecord): Record<string, unknown> {
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
