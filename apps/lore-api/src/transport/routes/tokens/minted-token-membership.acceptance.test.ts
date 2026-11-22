import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LEGACY_TOKEN,
  makePool,
  useRateLimitSafeClock,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import { buildServer } from "../../../app/build-server.js";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

const FIXED_NOW = new Date("2026-11-22T10:00:00.000Z");
const GITHUB_ORG = "acme-org";
const INSTALLATION_ID = "12345";
const UI_URL = "http://localhost:3000";
const API_URL = "http://localhost:3001";
const ENCRYPTION_KEY = "0123456789abcdef".repeat(4);
const APP_INSTALLATION_TOKEN = "ghs_app_install_token";

const APP_PRIVATE_KEY = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
}).privateKey;

const STANDARD_TOKEN_COLUMNS = new Set([
  "id",
  "name",
  "token_hash",
  "scopes",
  "created_by",
  "expires_at",
  "revoked_at",
  "last_used",
  "created_at",
  "kind",
  "login",
  "display_name",
  "avatar_url",
  "repos",
  "repos_refreshed_at",
]);

interface GithubPerson {
  id: number;
  login: string;
  name: string;
  userAccessToken: string;
  userRefreshToken: string;
  userMembershipStatus: number;
  appMembershipStatus: number;
  userRepos: string[];
}

interface RecordedMembershipCall {
  path: string;
  authorization: string;
}

interface PoolState {
  apiTokens: Array<Record<string, unknown>>;
  sessionTokens: Array<Record<string, unknown>>;
  handoffs: Map<string, Record<string, unknown>>;
  genericTables: Map<string, Array<Record<string, unknown>>>;
  generations: Map<number, number>;
  repos: Array<Record<string, unknown>>;
  repoReadCount: number;
}

describe("Membership checks and minted tokens (FR-043 to FR-049)", () => {
  useRateLimitSafeClock();

  beforeEach(() => {
    vi.useFakeTimers({ now: FIXED_NOW, toFake: ["Date"] });
    configureEnv();
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("refuses sign-in and answers with an install fault distinct from non-member when GitHub refuses membership for want of permission", async () => {
    const harness = createHarness([
      makePerson(987654, "alice", { userMembershipStatus: 404 }),
    ]);

    const nonMemberRes = await runSignInCallback(harness, "alice");

    harness.setPersonMembership("alice", { userMembershipStatus: 403 });
    const permissionRefusedRes = await runSignInCallback(harness, "alice");
    const nonMemberError = redirectParam(nonMemberRes, "auth_error");
    const permissionError = redirectParam(permissionRefusedRes, "auth_error");

    expect({
      nonMemberCode: redirectParam(nonMemberRes, "code"),
      permissionRefusedCode: redirectParam(permissionRefusedRes, "code"),
      redeemHandoffs: harness.redeemHandoffCount(),
      apiTokenCount: harness.apiTokens().length,
      installFaultDistinctFromNonMember: isDistinctInstallFault(
        permissionRefusedRes.statusCode,
        permissionError,
        nonMemberError,
      ),
    }).toEqual({
      nonMemberCode: null,
      permissionRefusedCode: null,
      redeemHandoffs: 0,
      apiTokenCount: 0,
      installFaultDistinctFromNonMember: true,
    });
  });

  it("records the maker's GitHub numeric id in pipeline.api_tokens when a person mints a token through POST /api/tokens", async () => {
    const harness = createHarness([makePerson(987654, "alice")]);
    const sessionToken = await signInPerson(harness, "alice");
    const mintRes = await harness.server.inject({
      method: "POST",
      url: "/api/tokens",
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: { name: "alice-ci", scopes: ["read"] },
    });
    const mintedRow = harness
      .apiTokens()
      .find((row) => row.name === "alice-ci");

    expect({
      statusCode: mintRes.statusCode,
      recordedNumericId: hasMakerGithubId(mintedRow, 987654),
    }).toEqual({
      statusCode: 201,
      recordedNumericId: true,
    });
  });

  it("checks the maker's org membership as the App after five minutes when a minted token is used, and reports GitHub permission refusal as an install fault without admitting anyone or revoking tokens", async () => {
    const harness = createHarness([makePerson(987654, "alice")]);
    const sessionToken = await signInPerson(harness, "alice");
    const mintedToken = await mintUserToken(harness, sessionToken, "alice-ci");
    const lifecycle = await measureAppMembershipLifecycle(harness, mintedToken);

    expect(lifecycle).toEqual({
      freshStatus: 200,
      callsWhileFresh: 0,
      installFaultOutcome: "install-fault",
      revokedAfterInstallFault: false,
      recoveredStatus: 200,
      usedAppAuth: true,
      cachedAgainStatus: 200,
      callsUnchangedWhileCached: true,
    });
  });

  it("refuses a minted token whose maker is no longer an active member, revokes every token they minted, and ends every session of theirs", async () => {
    const harness = createHarness([
      makePerson(987654, "alice"),
      makePerson(555666, "bob"),
    ]);
    const actors = await setupRemovedMemberScenario(harness);
    const results = await exerciseAfterRemoval(harness, actors);

    expect(results).toEqual({
      firstRemoved: "refused",
      secondMinted: "refused",
      sessionOne: "refused",
      sessionTwo: "refused",
      repoReadsDuringRefusals: 0,
      aliceAllRevoked: true,
      bobKept: { tokenStatus: 200, sessionStatus: 200 },
    });
  });

  it("adds one to the removed person's generation so a sign-in that began before the removal creates no session after it", async () => {
    const harness = createHarness([makePerson(987654, "alice")]);
    const sessionToken = await signInPerson(harness, "alice");
    const mintedToken = await mintUserToken(harness, sessionToken, "alice-ci");
    const startedBeforeRemoval = await runSignInCallback(harness, "alice");
    const handoffGeneration = harness.redeemHandoffGenerations();

    vi.setSystemTime(Date.now() + 6 * 60_000);
    harness.setPersonMembership("alice", { appMembershipStatus: 404 });
    await callApi(harness.server, "GET", "/api/repos", mintedToken);
    const tokensBeforeRedeem = harness.apiTokens().length;
    const redeemRes = await harness.server.inject({
      method: "POST",
      url: "/api/auth/redeem",
      payload: { code: redirectParam(startedBeforeRemoval, "code") ?? "" },
    });

    expect({
      handoffGeneration,
      generationAfterRemoval: harness.generationOf(987654),
      redeemStatus: redeemRes.statusCode,
      newTokenRows: harness.apiTokens().length - tokensBeforeRedeem,
    }).toEqual({
      handoffGeneration: [0],
      generationAfterRemoval: 1,
      redeemStatus: 401,
      newTokenRows: 0,
    });
  });

  it("records the generation the person had at sign-in on the session row", async () => {
    const harness = createHarness([makePerson(987654, "alice")]);

    await signInPerson(harness, "alice");

    expect(harness.apiTokens().map((row) => row.generation)).toEqual([0]);
  });

  it("refuses to mint a stations token through POST /api/tokens", async () => {
    const harness = createHarness([makePerson(987654, "alice")]);
    const stationsPluralRes = await harness.server.inject({
      method: "POST",
      url: "/api/tokens",
      headers: { authorization: `Bearer ${LEGACY_TOKEN}` },
      payload: { name: "stations", kind: "stations", scopes: ["admin"] },
    });
    const stationSingularRes = await harness.server.inject({
      method: "POST",
      url: "/api/tokens",
      headers: { authorization: `Bearer ${LEGACY_TOKEN}` },
      payload: { name: "station-svc", kind: "station", scopes: ["admin"] },
    });

    expect({
      pluralOutcome: clientRefusalOutcome(stationsPluralRes.statusCode),
      singularOutcome: clientRefusalOutcome(stationSingularRes.statusCode),
      storedTokens: harness.apiTokens().length,
    }).toEqual({
      pluralOutcome: "refused",
      singularOutcome: "refused",
      storedTokens: 0,
    });
  });

  it("refuses a stale minted token without revoking anything when GitHub errors on the App's membership question", async () => {
    const harness = createHarness([makePerson(987654, "alice")]);
    const sessionToken = await signInPerson(harness, "alice");
    const mintedToken = await mintUserToken(harness, sessionToken, "alice-ci");

    vi.setSystemTime(Date.now() + 6 * 60_000);
    harness.setPersonMembership("alice", { appMembershipStatus: 500 });
    const res = await callApi(harness.server, "GET", "/api/repos", mintedToken);

    expect({
      admitted: res.statusCode < 400,
      repoReads: harness.repoReadCount(),
      revoked: harness.isTokenRevoked(mintedToken),
    }).toEqual({ admitted: false, repoReads: 0, revoked: false });
  }, 60_000);

  it("refuses a stale minted token when GitHub answers the maker's membership as pending rather than active", async () => {
    const harness = createHarness([makePerson(987654, "alice")]);
    const sessionToken = await signInPerson(harness, "alice");
    const mintedToken = await mintUserToken(harness, sessionToken, "alice-ci");

    vi.setSystemTime(Date.now() + 6 * 60_000);
    answerAppMembershipAs({ state: "pending", role: "member" });
    const readsBefore = harness.repoReadCount();
    const res = await callApi(harness.server, "GET", "/api/repos", mintedToken);

    expect({
      outcome: membershipRefusalOutcome(res.statusCode),
      repoReads: harness.repoReadCount() - readsBefore,
    }).toEqual({ outcome: "refused", repoReads: 0 });
  });

  it("refuses writes to POST /api/tokens made with a removed maker's minted token and writes nothing", async () => {
    const harness = createHarness([
      makePerson(987654, "alice"),
      makePerson(555666, "bob"),
    ]);
    const { aliceAdminToken, bobToken, bobTokenId } =
      await mintAliceAdminAndBobTokens(harness);

    vi.setSystemTime(Date.now() + 6 * 60_000);
    harness.setPersonMembership("alice", {
      userMembershipStatus: 404,
      appMembershipStatus: 404,
    });
    const tokensBefore = harness.apiTokens().length;
    const mintRes = await harness.server.inject({
      method: "POST",
      url: "/api/tokens",
      headers: { authorization: `Bearer ${aliceAdminToken}` },
      payload: { name: "after-removal", scopes: ["admin"] },
    });
    const revokeRes = await harness.server.inject({
      method: "POST",
      url: "/api/tokens",
      headers: { authorization: `Bearer ${aliceAdminToken}` },
      payload: { action: "revoke", token_id: bobTokenId },
    });

    expect({
      mintOutcome: membershipRefusalOutcome(mintRes.statusCode),
      revokeOutcome: membershipRefusalOutcome(revokeRes.statusCode),
      newTokens: harness.apiTokens().length - tokensBefore,
      bobRevoked: harness.isTokenRevoked(bobToken),
    }).toEqual({
      mintOutcome: "refused",
      revokeOutcome: "refused",
      newTokens: 0,
      bobRevoked: false,
    });
  });

  it("keeps a stale minted token working without asking GitHub when no org is configured", async () => {
    const harness = createHarness([makePerson(987654, "alice")]);
    const sessionToken = await signInPerson(harness, "alice");
    const mintedToken = await mintUserToken(harness, sessionToken, "alice-ci");

    delete process.env.GITHUB_ORG;
    vi.setSystemTime(Date.now() + 6 * 60_000);
    harness.setPersonMembership("alice", { appMembershipStatus: 404 });
    const res = await callApi(harness.server, "GET", "/api/repos", mintedToken);

    expect({
      statusCode: res.statusCode,
      membershipCalls: harness.appMembershipCalls().length,
      revoked: harness.isTokenRevoked(mintedToken),
    }).toEqual({ statusCode: 200, membershipCalls: 0, revoked: false });
  });

  it("never re-checks a minted token that records no maker GitHub id", async () => {
    const harness = createHarness([makePerson(987654, "alice")]);
    const mintRes = await harness.server.inject({
      method: "POST",
      url: "/api/tokens",
      headers: { authorization: `Bearer ${LEGACY_TOKEN}` },
      payload: { name: "ci-bot", scopes: ["read"] },
    });
    const botToken = (mintRes.result as { token: string }).token;

    vi.setSystemTime(Date.now() + 6 * 60_000);
    harness.setPersonMembership("alice", { appMembershipStatus: 404 });
    const res = await callApi(harness.server, "GET", "/api/repos", botToken);

    expect({
      statusCode: res.statusCode,
      membershipCalls: harness.appMembershipCalls().length,
      revoked: harness.isTokenRevoked(botToken),
    }).toEqual({ statusCode: 200, membershipCalls: 0, revoked: false });
  });
});

function answerAppMembershipAs(body: Record<string, unknown>): void {
  const underlying = globalThis.fetch;

  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.toString());

    if (
      url.hostname === "api.github.com" &&
      url.pathname.startsWith(`/orgs/${GITHUB_ORG}/memberships/`)
    ) {
      return jsonResponse(body);
    }

    return underlying(input, init);
  };
}

async function mintAliceAdminAndBobTokens(
  harness: ReturnType<typeof createHarness>,
) {
  const aliceSession = await signInPerson(harness, "alice");
  const aliceAdminToken = await mintScopedToken(
    harness,
    aliceSession,
    "alice-admin",
    ["admin"],
  );
  const bobSession = await signInPerson(harness, "bob");
  const bobToken = await mintUserToken(harness, bobSession, "bob-one");
  const bobRow = harness.apiTokens().find((row) => row.name === "bob-one");

  return { aliceAdminToken, bobToken, bobTokenId: String(bobRow?.id) };
}

async function mintScopedToken(
  harness: ReturnType<typeof createHarness>,
  sessionToken: string,
  name: string,
  scopes: string[],
): Promise<string> {
  const res = await harness.server.inject({
    method: "POST",
    url: "/api/tokens",
    headers: { authorization: `Bearer ${sessionToken}` },
    payload: { name, scopes },
  });

  return (res.result as { token: string }).token;
}

function configureEnv(): void {
  process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  process.env.GITHUB_ORG = GITHUB_ORG;
  process.env.GITHUB_APP_ID = "999";
  process.env.GITHUB_APP_PRIVATE_KEY = APP_PRIVATE_KEY;
  process.env.GITHUB_APP_INSTALLATION_ID = INSTALLATION_ID;
  process.env.GITHUB_APP_CLIENT_ID = "Iv1.app-client-1";
  process.env.GITHUB_APP_CLIENT_SECRET = "app-secret-1";
  process.env.LORE_USER_TOKEN_ENCRYPTION_KEY = ENCRYPTION_KEY;
  process.env.LORE_UI_URL = UI_URL;
  process.env.LORE_API_URL = API_URL;
  delete process.env.GITHUB_TOKEN;
}

function makePerson(
  id: number,
  login: string,
  overrides: Partial<GithubPerson> = {},
): GithubPerson {
  return {
    id,
    login,
    name: login.toUpperCase(),
    userAccessToken: `ghu_access_${login}`,
    userRefreshToken: `ghr_refresh_${login}`,
    userMembershipStatus: 200,
    appMembershipStatus: 200,
    userRepos: ["acme/app"],
    ...overrides,
  };
}

function createHarness(initialPeople: GithubPerson[]) {
  const people = new Map(initialPeople.map((person) => [person.login, person]));
  const membershipCalls: RecordedMembershipCall[] = [];
  const state: PoolState = {
    apiTokens: [],
    sessionTokens: [],
    handoffs: new Map(),
    genericTables: new Map(),
    generations: new Map(),
    repos: [
      {
        id: "repo-1",
        owner: "acme",
        name: "app",
        fullName: "acme/app",
        onboardedAt: FIXED_NOW.toISOString(),
        onboardingPrUrl: null,
        onboardingPrMerged: false,
        settings: {},
      },
    ],
    repoReadCount: 0,
  };
  const pool = createFakePool(state);

  globalThis.fetch = createGithubFetchStub(people, membershipCalls);
  const server = buildServer(() => pool as never);

  return {
    server,
    apiTokens: () => state.apiTokens,
    repoReadCount: () => state.repoReadCount,
    generationOf: (githubId: number) => state.generations.get(githubId) ?? 0,
    redeemHandoffGenerations: () =>
      [...state.handoffs.values()]
        .filter((row) => row.phase === "redeem")
        .map((row) => row.generation),
    redeemHandoffCount: () =>
      [...state.handoffs.values()].filter((row) => row.phase === "redeem")
        .length,
    appMembershipCalls: () => [...membershipCalls],
    isTokenRevoked: (rawToken: string) => {
      const hash = sha256(rawToken);
      const row = state.apiTokens.find((entry) => entry.token_hash === hash);

      return Boolean(row && row.revoked_at !== null);
    },
    setPersonMembership: (
      login: string,
      patch: Partial<
        Pick<GithubPerson, "userMembershipStatus" | "appMembershipStatus">
      >,
    ) => {
      const person = people.get(login);

      if (person) {
        Object.assign(person, patch);
      }
    },
  };
}

async function measureAppMembershipLifecycle(
  harness: ReturnType<typeof createHarness>,
  mintedToken: string,
) {
  const fresh = await probeFreshWindow(harness, mintedToken);
  const refusal = await probeInstallFaultWindow(harness, mintedToken);
  const recovery = await probeRecoveryAndCache(harness, mintedToken);

  return { ...fresh, ...refusal, ...recovery };
}

async function probeFreshWindow(
  harness: ReturnType<typeof createHarness>,
  mintedToken: string,
) {
  const freshRes = await callApi(
    harness.server,
    "GET",
    "/api/repos",
    mintedToken,
  );

  return {
    freshStatus: freshRes.statusCode,
    callsWhileFresh: harness.appMembershipCalls().length,
  };
}

async function probeInstallFaultWindow(
  harness: ReturnType<typeof createHarness>,
  mintedToken: string,
) {
  vi.setSystemTime(Date.now() + 6 * 60_000);
  harness.setPersonMembership("alice", { appMembershipStatus: 403 });
  const permissionRefusedRes = await callApi(
    harness.server,
    "GET",
    "/api/repos",
    mintedToken,
  );

  return {
    installFaultOutcome: installFaultOutcome(permissionRefusedRes.statusCode),
    revokedAfterInstallFault: harness.isTokenRevoked(mintedToken),
  };
}

async function probeRecoveryAndCache(
  harness: ReturnType<typeof createHarness>,
  mintedToken: string,
) {
  harness.setPersonMembership("alice", { appMembershipStatus: 200 });
  const recoveredRes = await callApi(
    harness.server,
    "GET",
    "/api/repos",
    mintedToken,
  );
  const countAfterRefresh = harness.appMembershipCalls().length;
  const usedAppAuth = usedAppInstallAuth(harness.appMembershipCalls());

  vi.setSystemTime(Date.now() + 2 * 60_000);
  const cachedAgainRes = await callApi(
    harness.server,
    "GET",
    "/api/repos",
    mintedToken,
  );

  return {
    recoveredStatus: recoveredRes.statusCode,
    usedAppAuth,
    cachedAgainStatus: cachedAgainRes.statusCode,
    callsUnchangedWhileCached:
      harness.appMembershipCalls().length === countAfterRefresh,
  };
}

interface RemovedMemberActors {
  aliceSessionOne: string;
  aliceSessionTwo: string;
  aliceTokenOne: string;
  aliceTokenTwo: string;
  bobSession: string;
  bobToken: string;
}

async function setupRemovedMemberScenario(
  harness: ReturnType<typeof createHarness>,
): Promise<RemovedMemberActors> {
  const aliceSessionOne = await signInPerson(harness, "alice");
  const aliceSessionTwo = await signInPerson(harness, "alice");
  const aliceTokenOne = await mintUserToken(
    harness,
    aliceSessionOne,
    "alice-one",
  );
  const aliceTokenTwo = await mintUserToken(
    harness,
    aliceSessionOne,
    "alice-two",
  );
  const bobSession = await signInPerson(harness, "bob");
  const bobToken = await mintUserToken(harness, bobSession, "bob-one");

  return {
    aliceSessionOne,
    aliceSessionTwo,
    aliceTokenOne,
    aliceTokenTwo,
    bobSession,
    bobToken,
  };
}

async function exerciseAfterRemoval(
  harness: ReturnType<typeof createHarness>,
  actors: RemovedMemberActors,
) {
  vi.setSystemTime(Date.now() + 6 * 60_000);
  harness.setPersonMembership("alice", {
    userMembershipStatus: 404,
    appMembershipStatus: 404,
  });

  const aliceResults = await probeRemovedAliceTokens(harness, actors);
  const bobKept = await probeUnaffectedBob(harness, actors);

  return { ...aliceResults, bobKept };
}

async function probeRemovedAliceTokens(
  harness: ReturnType<typeof createHarness>,
  actors: RemovedMemberActors,
) {
  const readsBeforeRefusal = harness.repoReadCount();
  const firstRemoved = membershipRefusalOutcome(
    (await callApi(harness.server, "GET", "/api/repos", actors.aliceTokenOne))
      .statusCode,
  );
  const secondMinted = membershipRefusalOutcome(
    (await callApi(harness.server, "GET", "/api/repos", actors.aliceTokenTwo))
      .statusCode,
  );
  const sessionOne = membershipRefusalOutcome(
    (
      await callApi(
        harness.server,
        "GET",
        "/api/auth/me",
        actors.aliceSessionOne,
      )
    ).statusCode,
  );
  const sessionTwo = membershipRefusalOutcome(
    (
      await callApi(
        harness.server,
        "GET",
        "/api/auth/me",
        actors.aliceSessionTwo,
      )
    ).statusCode,
  );

  return {
    firstRemoved,
    secondMinted,
    sessionOne,
    sessionTwo,
    repoReadsDuringRefusals: harness.repoReadCount() - readsBeforeRefusal,
    aliceAllRevoked: [
      actors.aliceTokenOne,
      actors.aliceTokenTwo,
      actors.aliceSessionOne,
      actors.aliceSessionTwo,
    ].every((tok) => harness.isTokenRevoked(tok)),
  };
}

async function probeUnaffectedBob(
  harness: ReturnType<typeof createHarness>,
  actors: RemovedMemberActors,
) {
  const bobTokenRes = await callApi(
    harness.server,
    "GET",
    "/api/repos",
    actors.bobToken,
  );
  const bobSessionRes = await callApi(
    harness.server,
    "GET",
    "/api/auth/me",
    actors.bobSession,
  );

  return {
    tokenStatus: bobTokenRes.statusCode,
    sessionStatus: bobSessionRes.statusCode,
  };
}

async function runSignInCallback(
  harness: ReturnType<typeof createHarness>,
  login: string,
) {
  const loginRes = await harness.server.inject({
    method: "GET",
    url: `/api/auth/login?return=${encodeURIComponent(`${UI_URL}/inbox`)}`,
  });
  const state =
    new URL(String(loginRes.headers.location)).searchParams.get("state") ?? "";

  return harness.server.inject({
    method: "GET",
    url: `/api/auth/callback?code=${encodeURIComponent(`code:${login}`)}&state=${encodeURIComponent(state)}`,
  });
}

async function signInPerson(
  harness: ReturnType<typeof createHarness>,
  login: string,
): Promise<string> {
  const callbackRes = await runSignInCallback(harness, login);
  const code = redirectParam(callbackRes, "code") ?? "";
  const redeemRes = await harness.server.inject({
    method: "POST",
    url: "/api/auth/redeem",
    payload: { code },
  });

  return (redeemRes.result as { token: string }).token;
}

async function mintUserToken(
  harness: ReturnType<typeof createHarness>,
  sessionToken: string,
  name: string,
): Promise<string> {
  const res = await harness.server.inject({
    method: "POST",
    url: "/api/tokens",
    headers: { authorization: `Bearer ${sessionToken}` },
    payload: { name, scopes: ["read"] },
  });

  return (res.result as { token: string }).token;
}

function callApi(
  server: ReturnType<typeof buildServer>,
  method: "GET" | "POST",
  url: string,
  token: string,
) {
  return server.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
  });
}

function redirectParam(
  res: { headers: Record<string, unknown> },
  key: string,
): string | null {
  const location = res.headers.location;

  if (typeof location !== "string" || !location) {
    return null;
  }

  return new URL(location).searchParams.get(key);
}

function isDistinctInstallFault(
  statusCode: number,
  permissionError: string | null,
  nonMemberError: string | null,
): boolean {
  if (statusCode >= 500) {
    return true;
  }

  return Boolean(permissionError) && permissionError !== nonMemberError;
}

function hasMakerGithubId(
  row: Record<string, unknown> | undefined,
  expectedId: number,
): boolean {
  if (!row) {
    return false;
  }

  return Object.entries(row).some(
    ([column, value]) =>
      !STANDARD_TOKEN_COLUMNS.has(column) &&
      (value === expectedId || value === String(expectedId)),
  );
}

function installFaultOutcome(statusCode: number): string {
  if (statusCode === 502 || statusCode === 503 || statusCode === 424) {
    return "install-fault";
  }

  return `unexpected-status:${statusCode}`;
}

function membershipRefusalOutcome(statusCode: number): string {
  if (statusCode === 401 || statusCode === 403) {
    return "refused";
  }

  return `unexpected-status:${statusCode}`;
}

function clientRefusalOutcome(statusCode: number): string {
  if (statusCode === 400 || statusCode === 403) {
    return "refused";
  }

  return `unexpected-status:${statusCode}`;
}

function usedAppInstallAuth(calls: RecordedMembershipCall[]): boolean {
  if (calls.length === 0) {
    return false;
  }

  return calls.every(
    (entry) =>
      entry.authorization.includes(APP_INSTALLATION_TOKEN) &&
      !entry.authorization.includes("ghu_"),
  );
}

function sha256(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function createGithubFetchStub(
  people: Map<string, GithubPerson>,
  membershipCalls: RecordedMembershipCall[],
): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.toString());

    if (
      url.hostname === "github.com" &&
      url.pathname === "/login/oauth/access_token"
    ) {
      return oauthTokenResponse(init, people);
    }

    if (url.hostname === "api.github.com") {
      return githubApiResponse(url, init, people, membershipCalls);
    }

    return new Response("not found", { status: 404 });
  };
}

function oauthTokenResponse(
  init: RequestInit | undefined,
  people: Map<string, GithubPerson>,
): Response {
  const payload = JSON.parse(String(init?.body ?? "{}")) as { code?: string };
  const login = String(payload.code ?? "").replace(/^code:/, "");
  const person = people.get(login);

  if (!person) {
    return jsonResponse({ error: "bad_verification_code" }, 400);
  }

  return jsonResponse({
    access_token: person.userAccessToken,
    token_type: "bearer",
    expires_in: 28_800,
    refresh_token: person.userRefreshToken,
    refresh_token_expires_in: 15_811_200,
  });
}

function githubApiResponse(
  url: URL,
  init: RequestInit | undefined,
  people: Map<string, GithubPerson>,
  membershipCalls: RecordedMembershipCall[],
): Response {
  if (url.pathname === `/app/installations/${INSTALLATION_ID}/access_tokens`) {
    return jsonResponse({
      token: APP_INSTALLATION_TOKEN,
      expires_at: "2026-11-22T20:00:00Z",
    });
  }

  const authorization = headerValue(init?.headers, "authorization");
  const byToken = findPersonByAccessToken(people, authorization);
  const userRes = byToken ? handleUserGithubApi(url.pathname, byToken) : null;

  if (userRes) {
    return userRes;
  }

  return appGithubApiResponse(
    url.pathname,
    authorization,
    people,
    membershipCalls,
  );
}

function handleUserGithubApi(
  pathname: string,
  person: GithubPerson,
): Response | null {
  if (pathname === "/user") {
    return jsonResponse({
      id: person.id,
      login: person.login,
      name: person.name,
      avatar_url: `https://avatars.example/${person.login}.png`,
    });
  }

  if (pathname === `/user/memberships/orgs/${GITHUB_ORG}`) {
    return userMembershipResponse(person.userMembershipStatus);
  }

  if (pathname === "/user/repos") {
    return jsonResponse(person.userRepos.map(toGithubRepoJson));
  }

  if (pathname === `/user/installations/${INSTALLATION_ID}/repositories`) {
    return jsonResponse({
      total_count: person.userRepos.length,
      repositories: person.userRepos.map(toGithubRepoJson),
    });
  }

  return null;
}

function appGithubApiResponse(
  pathname: string,
  authorization: string,
  people: Map<string, GithubPerson>,
  membershipCalls: RecordedMembershipCall[],
): Response {
  const userById = /^\/user\/(\d+)$/.exec(pathname);

  if (userById) {
    const matched = [...people.values()].find(
      (person) => person.id === Number(userById[1]),
    );

    return matched
      ? jsonResponse({
          id: matched.id,
          login: matched.login,
          name: matched.name,
        })
      : jsonResponse({ message: "Not Found" }, 404);
  }

  const membershipMatch = new RegExp(
    `^/orgs/${GITHUB_ORG}/(?:memberships|members)/([^/]+)$`,
  ).exec(pathname);

  if (!membershipMatch) {
    return jsonResponse({ message: "Not Found" }, 404);
  }

  membershipCalls.push({ path: pathname, authorization });
  const person = people.get(decodeURIComponent(membershipMatch[1]));
  const status = person?.appMembershipStatus ?? 404;

  return appMembershipResponse(pathname, status);
}

function userMembershipResponse(status: number): Response {
  if (status === 403) {
    return jsonResponse(
      { message: "Resource not accessible by integration" },
      403,
    );
  }

  if (status >= 400) {
    return jsonResponse({ message: "Not Found" }, status);
  }

  return jsonResponse({ state: "active", role: "member" });
}

function appMembershipResponse(pathname: string, status: number): Response {
  if (status === 403) {
    return jsonResponse(
      { message: "Resource not accessible by integration" },
      403,
    );
  }

  if (status >= 400) {
    return jsonResponse({ message: "Not Found" }, status);
  }

  if (pathname.includes("/memberships/")) {
    return jsonResponse({ state: "active", role: "member" });
  }

  return new Response(null, { status: 204 });
}

function findPersonByAccessToken(
  people: Map<string, GithubPerson>,
  authorization: string,
): GithubPerson | undefined {
  return [...people.values()].find(
    (person) =>
      authorization === `Bearer ${person.userAccessToken}` ||
      authorization === `token ${person.userAccessToken}`,
  );
}

function headerValue(headers: HeadersInit | undefined, name: string): string {
  return new Headers(headers).get(name) ?? "";
}

function toGithubRepoJson(fullName: string) {
  const [owner, name] = fullName.split("/");

  return { full_name: fullName, name, owner: { login: owner } };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
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
    copyPoolState(committed, tx.staged);

    return { rows: [] };
  }

  if (trimmed === "ROLLBACK") {
    tx.active = false;

    return { rows: [] };
  }

  return executePoolSql(tx.active ? tx.staged : committed, rawSql, params);
}

function clonePoolState(source: PoolState): PoolState {
  const genericTables = new Map<string, Array<Record<string, unknown>>>();

  for (const [table, rows] of source.genericTables.entries()) {
    genericTables.set(
      table,
      rows.map((row) => ({ ...row })),
    );
  }

  return {
    apiTokens: source.apiTokens.map((row) => ({ ...row })),
    sessionTokens: source.sessionTokens.map((row) => ({ ...row })),
    handoffs: new Map(
      [...source.handoffs.entries()].map(([key, row]) => [key, { ...row }]),
    ),
    genericTables,
    generations: new Map(source.generations),
    repos: source.repos.map((row) => ({ ...row })),
    repoReadCount: source.repoReadCount,
  };
}

function copyPoolState(target: PoolState, source: PoolState): void {
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

  target.generations.clear();

  for (const [githubId, generation] of source.generations.entries()) {
    target.generations.set(githubId, generation);
  }

  target.genericTables.clear();

  for (const [table, rows] of source.genericTables.entries()) {
    target.genericTables.set(table, rows);
  }
}

function executePoolSql(
  state: PoolState,
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  if (sql.includes("pipeline.person_generations")) {
    return handleGenerationSql(state.generations, sql, params);
  }

  if (sql.includes("lore.login_handoffs")) {
    return handleHandoffSql(state.handoffs, sql, params);
  }

  if (sql.includes("pipeline.api_tokens")) {
    return handleApiTokensSql(state, sql, params);
  }

  if (sql.includes("pipeline.user_session_tokens")) {
    return handleSessionTokensSql(state, sql, params);
  }

  if (sql.includes("FROM lore.repos")) {
    state.repoReadCount += 1;

    return handleReposSql(state.repos, sql, params);
  }

  return handleGenericTableSql(state.genericTables, sql, params);
}

function handleGenerationSql(
  generations: Map<number, number>,
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  const githubId = Number(params[0]);

  if (sql.includes("INSERT INTO pipeline.person_generations")) {
    generations.set(githubId, (generations.get(githubId) ?? 0) + 1);

    return { rows: [] };
  }

  return generations.has(githubId)
    ? { rows: [{ generation: generations.get(githubId) }] }
    : { rows: [] };
}

function handleHandoffSql(
  handoffs: Map<string, Record<string, unknown>>,
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  if (sql.includes("INSERT INTO lore.login_handoffs")) {
    const columns = insertColumnsOf(sql, "lore.login_handoffs");
    const row = mapColumns(columns, params);

    handoffs.set(String(row.code_hash), row);

    return { rows: [] };
  }

  if (!sql.includes("RETURNING")) {
    return { rows: [] };
  }

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
        generation: row.generation ?? null,
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
    return updateApiTokenRows(state, sql, params);
  }

  if (sql.includes("count(*)::int as total")) {
    const active = state.apiTokens.filter((row) => row.revoked_at === null);

    return { rows: [{ total: active.length }] };
  }

  const matching = findMatchingTokenRows(state.apiTokens, sql, params);

  return { rows: matching.map((row) => projectTokenRow(state, row)) };
}

function insertApiTokenRow(
  apiTokens: Array<Record<string, unknown>>,
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

function updateApiTokenRows(
  state: PoolState,
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  const matches = findMatchingTokenRows(state.apiTokens, sql, params);

  for (const row of matches) {
    applyTokenUpdates(row, sql, params);
  }

  if (!sql.includes("RETURNING")) {
    return { rows: [] };
  }

  return { rows: matches.map((row) => projectTokenRow(state, row)) };
}

function findMatchingTokenRows(
  apiTokens: Array<Record<string, unknown>>,
  sql: string,
  params: unknown[],
): Array<Record<string, unknown>> {
  const whereMatch = /WHERE\s+(\w+)\s*=\s*\$(\d+)/i.exec(sql);

  return apiTokens.filter((row) =>
    tokenRowMatches(row, sql, whereMatch, params),
  );
}

function tokenRowMatches(
  row: Record<string, unknown>,
  sql: string,
  whereMatch: RegExpExecArray | null,
  params: unknown[],
): boolean {
  if (sql.includes("revoked_at IS NULL") && row.revoked_at !== null) {
    return false;
  }

  if (sql.includes("kind = 'user'") && row.kind !== "user") {
    return false;
  }

  if (!whereMatch) {
    return true;
  }

  const column = whereMatch[1];
  const expected = params[Number(whereMatch[2]) - 1];

  return valuesMatch(row[column], expected);
}

function applyTokenUpdates(
  row: Record<string, unknown>,
  sql: string,
  params: unknown[],
): void {
  const now = new Date(Date.now());
  const setClause =
    /SET\s+([\s\S]+?)(?:\s+WHERE|\s+RETURNING|$)/i.exec(sql)?.[1] ?? "";

  for (const assignment of setClause.split(",")) {
    applyAssignment(row, assignment.trim(), params, now);
  }
}

function applyAssignment(
  row: Record<string, unknown>,
  assignment: string,
  params: unknown[],
  now: Date,
): void {
  const nowMatch = /^(\w+)\s*=\s*now\(\)$/i.exec(assignment);

  if (nowMatch) {
    row[nowMatch[1]] = now;

    return;
  }

  const paramMatch = /^(\w+)\s*=\s*\$(\d+)$/i.exec(assignment);

  if (paramMatch) {
    row[paramMatch[1]] = params[Number(paramMatch[2]) - 1];
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
    ...row,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    startedAt: row.created_at,
    expiresAt: row.expires_at ?? null,
    reposRefreshedAt: refreshedAt,
    encryptedTokens,
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

  if (sql.includes("DELETE FROM pipeline.user_session_tokens")) {
    return deleteSessionTokens(state, sql, params);
  }

  return { rows: [] };
}

function deleteSessionTokens(
  state: PoolState,
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  const whereMatch = /WHERE\s+(\w+)\s*=\s*\$(\d+)/i.exec(sql);

  if (!whereMatch) {
    return { rows: [] };
  }

  const expected = params[Number(whereMatch[2]) - 1];
  const kept = state.sessionTokens.filter(
    (entry) => !valuesMatch(entry[whereMatch[1]], expected),
  );

  state.sessionTokens.splice(0, state.sessionTokens.length, ...kept);

  return { rows: [] };
}

function handleReposSql(
  repos: Array<Record<string, unknown>>,
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  const readable = params.find((entry) => Array.isArray(entry)) as
    string[] | undefined;
  const filtered = readable
    ? repos.filter((repo) =>
        readable.some(
          (allowed) =>
            allowed.toLowerCase() === String(repo.fullName).toLowerCase(),
        ),
      )
    : repos;

  if (sql.includes("count(*)::int as total")) {
    return { rows: [{ total: filtered.length }] };
  }

  return {
    rows: filtered.map((repo) => ({
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
    })),
  };
}

function handleGenericTableSql(
  tables: Map<string, Array<Record<string, unknown>>>,
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  const insertMatch = /INSERT INTO\s+([^\s(]+)\s*\(([^)]+)\)/i.exec(sql);

  if (insertMatch) {
    return upsertGenericRow(tables, insertMatch, params);
  }

  const selectMatch = /FROM\s+([^\s]+)\s+WHERE\s+(\w+)\s*=\s*\$1/i.exec(sql);

  if (!selectMatch) {
    return { rows: [] };
  }

  const rows = tables.get(selectMatch[1]) ?? [];

  return {
    rows: rows.filter((entry) => valuesMatch(entry[selectMatch[2]], params[0])),
  };
}

function upsertGenericRow(
  tables: Map<string, Array<Record<string, unknown>>>,
  insertMatch: RegExpExecArray,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  const table = insertMatch[1];
  const columns = insertMatch[2].split(",").map((col) => col.trim());
  const row = mapColumns(columns, params);
  const rows = tables.get(table) ?? [];
  const keyCol = columns[0];
  const existingIndex = rows.findIndex((entry) =>
    valuesMatch(entry[keyCol], row[keyCol]),
  );

  if (existingIndex >= 0) {
    rows[existingIndex] = { ...rows[existingIndex], ...row };
  }

  if (existingIndex < 0) {
    rows.push(row);
  }
  tables.set(table, rows);

  return { rows: [row] };
}

function valuesMatch(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }

  if (isNullish(left) || isNullish(right)) {
    return false;
  }

  return String(left) === String(right);
}

function isNullish(value: unknown): boolean {
  return value === null || value === undefined;
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
