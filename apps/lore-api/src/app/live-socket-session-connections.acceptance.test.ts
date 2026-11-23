import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { AuthMessageType, writeAuthentication } from "@hocuspocus/common";
import { makePool } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import {
  cookieOf,
  queuedClient,
} from "../work/assembly-line-station/live-socket.fixtures.js";
import {
  bytesToBase64,
  type LiveServerMessage,
} from "../work/assembly-line-station/protocol.js";
import { buildServer } from "./build-server.js";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

const FIXED_NOW = new Date("2026-11-22T10:00:00.000Z");
const GITHUB_ORG = "acme-org";
const INSTALLATION_ID = "12345";
const UI_URL = "http://localhost:3000";
const API_URL = "http://localhost:3001";
const ADMIN_TOKEN = "live-socket-connections-admin-token";
const ENCRYPTION_KEY = "0123456789abcdef".repeat(4);
const APP_INSTALLATION_TOKEN = "ghs_app_install_token";
const HOCUSPOCUS_SYNC_MESSAGE = 0;
const HOCUSPOCUS_AUTH_MESSAGE = 2;
const REPO_ALPHA = "acme-org/alpha";

const APP_PRIVATE_KEY = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
}).privateKey;

let testEpoch = 0;

interface GithubPerson {
  id: number;
  login: string;
  name: string;
  userAccessToken: string;
  userRefreshToken: string;
  userRepos: string[];
}

interface CloseOutcome {
  closed: boolean;
  code: number | null;
  reason: string;
}

interface PoolState {
  apiTokens: Array<Record<string, unknown>>;
  sessionTokens: Array<Record<string, unknown>>;
  handoffs: Map<string, Record<string, unknown>>;
  generations: Map<number, number>;
  repos: Array<Record<string, unknown>>;
  plans: Array<Record<string, unknown>>;
  planStates: Map<string, Record<string, unknown>>;
  planVersions: Array<Record<string, unknown>>;
  planCollabTokens: Array<Record<string, unknown>>;
}

interface DirectCollabClient {
  ws: WebSocket;
  nextBytes: (timeoutMs?: number) => Promise<Uint8Array | null>;
  closeWait: (timeoutMs?: number) => Promise<CloseOutcome>;
}

describe("Live plan collaboration connections and missed-notification fallback (FR-304, FR-305)", () => {
  const activeHarnesses: Array<ReturnType<typeof createHarness>> = [];

  beforeEach(() => {
    vi.useFakeTimers({
      now: FIXED_NOW.getTime() + ++testEpoch * 3_600_000,
      toFake: ["Date"],
    });
    configureEnv();
  });

  afterEach(async () => {
    for (const harness of activeHarnesses.splice(0)) {
      await harness.stop();
    }
    vi.useRealTimers();
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  }, 60_000);

  it("closes already-open plan collaboration connections of a session when that session ends, leaving other sessions' collaboration connections open", async () => {
    const harness = await startedHarness([makePerson(987654, "alice")]);

    activeHarnesses.push(harness);
    const aliceSessionOne = await signInPerson(harness, "alice");
    const aliceSessionTwo = await signInPerson(harness, "alice");
    const planId = await createPlan(harness, REPO_ALPHA, "alice");
    const collabOne = await mintCollabForSession(
      harness,
      planId,
      aliceSessionOne,
    );
    const collabTwo = await mintCollabForSession(
      harness,
      planId,
      aliceSessionTwo,
    );
    const documentName = collabOne.documentName;
    const directOne = await harness.connectDirectCollab(
      documentName,
      collabOne.token,
    );
    const wsTwo = await harness.connect(aliceSessionTwo);

    await openAuthenticatedPlanChannel(
      wsTwo,
      "p1",
      documentName,
      collabOne.token,
    );
    const directTwo = await harness.connectDirectCollab(
      documentName,
      collabTwo.token,
    );
    const directOneClosedPromise = directOne.closeWait(800);
    const channelOneClosedPromise = nextClosedFor(wsTwo, "p1", 800);

    await callApi(harness.server, {
      method: "POST",
      url: "/api/auth/logout",
      token: aliceSessionOne,
    });
    const [directOneClosed, channelOneClosed] = await Promise.all([
      directOneClosedPromise,
      channelOneClosedPromise,
    ]);
    const directTwoReply = await probeDirectSync(directTwo, documentName);
    const wsTwoRepoStatus = (
      await sendRequest(wsTwo, "r2", "GET", "/api/repos")
    ).status;

    expect({
      directOneAuthVerdict: directOne.authVerdict,
      directTwoAuthVerdict: directTwo.authVerdict,
      directOneClosed: directOneClosed.closed,
      channelOneClosedType: channelOneClosed?.type ?? null,
      directTwoStillSyncs: directTwoReply !== null,
      wsTwoRepoStatus,
    }).toEqual({
      directOneAuthVerdict: AuthMessageType.Authenticated,
      directTwoAuthVerdict: AuthMessageType.Authenticated,
      directOneClosed: true,
      channelOneClosedType: "closed",
      directTwoStillSyncs: true,
      wsTwoRepoStatus: 200,
    });
  }, 15_000);

  it("closes a live socket and an open plan collaboration connection at the five-minute check when the replica missed the session-ended notification", async () => {
    const harness = await startedHarness([makePerson(987654, "alice")]);

    activeHarnesses.push(harness);
    const aliceSession = await signInPerson(harness, "alice");
    const planId = await createPlan(harness, REPO_ALPHA, "alice");
    const collab = await mintCollabForSession(harness, planId, aliceSession);
    const documentName = collab.documentName;
    const ws = await harness.connect(aliceSession);
    const directCollab = await harness.connectDirectCollab(
      documentName,
      collab.token,
    );

    harness.revokeInStoreWithoutNotify(aliceSession);
    vi.setSystemTime(nowMs() + 4 * 60_000);
    const early = await probeBeforeFiveMinutes(ws, directCollab, documentName);

    vi.setSystemTime(nowMs() + 2 * 60_000);
    const stale = await probeAfterFiveMinutes(ws, directCollab, documentName);

    expect({
      earlyWsOpen: early.wsOpen,
      earlyCollabSynced: early.collabSynced,
      wsClosed: stale.wsClosed,
      wsCloseCode: stale.wsCloseCode,
      collabClosed: stale.collabClosed,
    }).toEqual({
      earlyWsOpen: true,
      earlyCollabSynced: true,
      wsClosed: true,
      wsCloseCode: 4401,
      collabClosed: true,
    });
  });
});

async function probeBeforeFiveMinutes(
  ws: TrackedClient,
  directCollab: DirectCollabClient,
  documentName: string,
) {
  await sendRequest(ws, "early", "GET", "/api/repos");
  const wsOpen = ws.ws.readyState === WebSocket.OPEN;
  const collabReply = await probeDirectSync(directCollab, documentName);

  return { wsOpen, collabSynced: collabReply !== null };
}

async function probeAfterFiveMinutes(
  ws: TrackedClient,
  directCollab: DirectCollabClient,
  documentName: string,
) {
  const wsClosePromise = waitForClose(ws.ws, 1500);

  ws.send({
    type: "request",
    id: "stale-ws",
    method: "GET",
    path: "/api/repos",
  });
  const collabClosePromise = directCollab.closeWait(1500);

  directCollab.ws.send(hocuspocusSyncStep1Bytes(documentName));
  const [wsClosed, collabClosed] = await Promise.all([
    wsClosePromise,
    collabClosePromise,
  ]);

  return {
    wsClosed: wsClosed.closed,
    wsCloseCode: wsClosed.code,
    collabClosed: collabClosed.closed,
  };
}

async function startedHarness(initialPeople: GithubPerson[]) {
  const harness = createHarness(initialPeople);

  await harness.server.start();
  harness.setPort(Number(harness.server.info.port));

  return harness;
}

type TrackedClient = Awaited<
  ReturnType<ReturnType<typeof createHarness>["connect"]>
>;

async function probeDirectSync(
  client: DirectCollabClient,
  documentName: string,
): Promise<Uint8Array | null> {
  if (client.ws.readyState !== WebSocket.OPEN) {
    return null;
  }

  client.ws.send(hocuspocusSyncStep1Bytes(documentName));

  return client.nextBytes(1500);
}

async function sendRequest(
  ws: TrackedClient,
  id: string,
  method: string,
  path: string,
) {
  ws.send({ type: "request", id, method, path });

  return nextResponse(ws, id);
}

async function nextResponse(ws: TrackedClient, id: string) {
  for (;;) {
    const message = await ws.next();

    if (message.type === "response" && message.id === id) {
      return message;
    }
  }
}

async function nextClosedFor(
  ws: TrackedClient,
  channel: string,
  timeoutMs: number,
): Promise<LiveServerMessage | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      ws.ws.off("message", onMessage);
      resolve(null);
    }, timeoutMs);
    const onMessage = (raw: unknown) => {
      const message = JSON.parse(String(raw)) as LiveServerMessage;

      if (
        message.type === "closed" &&
        "channel" in message &&
        message.channel === channel
      ) {
        clearTimeout(timer);
        ws.ws.off("message", onMessage);
        resolve(message);
      }
    };

    ws.ws.on("message", onMessage);
  });
}

async function openAuthenticatedPlanChannel(
  ws: TrackedClient,
  channel: string,
  documentName: string,
  collabToken: string,
): Promise<void> {
  ws.send({ type: "open", channel, kind: "plan", subject: documentName });
  await nextOn(ws, channel);
  ws.send({
    type: "send",
    channel,
    data: hocuspocusAuthMessage(documentName, collabToken),
  });
  await nextOn(ws, channel);
}

async function nextOn(ws: TrackedClient, channel: string) {
  for (;;) {
    const message = await ws.next();

    if ("channel" in message && message.channel === channel) {
      return message;
    }
  }
}

function hocuspocusAuthMessage(documentName: string, token: string): string {
  return bytesToBase64(hocuspocusAuthBytes(documentName, token));
}

function hocuspocusAuthBytes(documentName: string, token: string): Uint8Array {
  const encoder = encoding.createEncoder();

  encoding.writeVarString(encoder, documentName);
  encoding.writeVarUint(encoder, HOCUSPOCUS_AUTH_MESSAGE);
  writeAuthentication(encoder, token);

  return encoding.toUint8Array(encoder);
}

function hocuspocusSyncStep1Bytes(documentName: string): Uint8Array {
  const encoder = encoding.createEncoder();

  encoding.writeVarString(encoder, documentName);
  encoding.writeVarUint(encoder, HOCUSPOCUS_SYNC_MESSAGE);
  encoding.writeVarUint(encoder, 0);
  encoding.writeVarUint8Array(encoder, new Uint8Array([0]));

  return encoding.toUint8Array(encoder);
}

function waitForClose(ws: WebSocket, timeoutMs: number): Promise<CloseOutcome> {
  if (ws.readyState === WebSocket.CLOSED) {
    return Promise.resolve({ closed: true, code: null, reason: "" });
  }

  return new Promise((resolve) => {
    const timer = setTimeout(
      () => resolve({ closed: false, code: null, reason: "" }),
      timeoutMs,
    );

    ws.once("close", (code, reason) => {
      clearTimeout(timer);
      resolve({ closed: true, code, reason: reason.toString("utf-8") });
    });
  });
}

async function createPlan(
  harness: ReturnType<typeof createHarness>,
  repo: string,
  createdBy: string,
): Promise<string> {
  const res = await callApi(harness.server, {
    method: "POST",
    url: "/api/plans",
    token: ADMIN_TOKEN,
    payload: { repo, title: "Live socket plan", type: "feature", createdBy },
  });

  enforceTrue(
    !(res.statusCode !== 200 && res.statusCode !== 201),
    Error,
    `createPlan failed: ${res.statusCode} ${res.payload}`,
  );

  return (res.result as { meta: { id: string } }).meta.id;
}

async function mintCollabForSession(
  harness: ReturnType<typeof createHarness>,
  planId: string,
  sessionToken: string,
): Promise<{ token: string; documentName: string }> {
  const res = await callApi(harness.server, {
    method: "POST",
    url: `/api/repos/${REPO_ALPHA}/plans/${planId}/collab-token`,
    token: sessionToken,
    payload: { user: { id: "alice", name: "ALICE" }, role: "write" },
  });

  if (res.statusCode !== 200) {
    throw new Error(
      `mintCollabForSession failed: ${res.statusCode} ${res.payload}`,
    );
  }

  return res.result as { token: string; documentName: string };
}

async function signInPerson(
  harness: ReturnType<typeof createHarness>,
  login: string,
): Promise<string> {
  const loginRes = await harness.server.inject({
    method: "GET",
    url: `/api/auth/login?return=${encodeURIComponent(`${UI_URL}/inbox`)}`,
  });
  const state =
    new URL(String(loginRes.headers.location)).searchParams.get("state") ?? "";
  const callbackRes = await harness.server.inject({
    method: "GET",
    url: `/api/auth/callback?code=${encodeURIComponent(`code:${login}`)}&state=${encodeURIComponent(state)}`,
  });
  const code = redirectParam(callbackRes, "code") ?? "";
  const redeemRes = await harness.server.inject({
    method: "POST",
    url: "/api/auth/redeem",
    payload: { code },
  });

  return (redeemRes.result as { token: string }).token;
}

function redirectParam(
  response: { headers: Record<string, unknown> },
  key: string,
): string | null {
  const location = response.headers.location;

  if (typeof location !== "string" || !location) {
    return null;
  }

  return new URL(location).searchParams.get(key);
}

async function callApi(
  server: ReturnType<typeof buildServer>,
  options: {
    method: "GET" | "POST" | "DELETE";
    url: string;
    token: string;
    payload?: object;
  },
) {
  return server.inject({
    method: options.method,
    url: options.url,
    headers: { authorization: `Bearer ${options.token}` },
    payload: options.payload,
  });
}

function configureEnv(): void {
  process.env.LORE_INGEST_TOKEN = ADMIN_TOKEN;
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

function makePerson(id: number, login: string): GithubPerson {
  return {
    id,
    login,
    name: login.toUpperCase(),
    userAccessToken: `ghu_access_${login}`,
    userRefreshToken: `ghr_refresh_${login}`,
    userRepos: [REPO_ALPHA],
  };
}

function nowMs(): number {
  return new Date().getTime();
}

function createHarness(initialPeople: GithubPerson[]) {
  const people = new Map(initialPeople.map((person) => [person.login, person]));
  const sockets: WebSocket[] = [];
  let port = 0;
  const state = initialPoolState();
  const pool = createFakePool(state);

  globalThis.fetch = createGithubFetchStub(people);
  const server = buildServer(() => pool as never);

  return {
    server,
    setPort: (nextPort: number) => {
      port = nextPort;
    },
    revokeInStoreWithoutNotify: (rawToken: string) => {
      const hash = sha256(rawToken);
      const row = state.apiTokens.find((entry) => entry.token_hash === hash);

      if (row) {
        row.revoked_at = new Date(nowMs());
      }
    },
    connect: async (sessionToken: string) => {
      const client = queuedClient(port, "/api/ws", cookieOf(sessionToken));

      sockets.push(client.ws);
      await client.open();

      return client;
    },
    connectDirectCollab: async (documentName: string, collabToken: string) => {
      const client = await openDirectCollab(
        port,
        documentName,
        collabToken,
        sockets,
      );

      return client;
    },
    stop: async () => {
      for (const ws of sockets.splice(0)) {
        ws.terminate();
      }
      await server.stop();
    },
  };
}

async function openDirectCollab(
  port: number,
  documentName: string,
  collabToken: string,
  sockets: WebSocket[],
): Promise<DirectCollabClient & { authVerdict: number }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/plans/collab`);
  const inbox: Uint8Array[] = [];
  const waiters: Array<(bytes: Uint8Array | null) => void> = [];

  sockets.push(ws);
  ws.on("message", (raw) => {
    const bytes = toUint8(raw);
    const waiter = waiters.shift();

    if (waiter) {
      waiter(bytes);

      return;
    }
    inbox.push(bytes);
  });
  ws.on("close", () => {
    while (waiters.length > 0) {
      waiters.shift()?.(null);
    }
  });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  const nextBytes = (timeoutMs = 1500): Promise<Uint8Array | null> => {
    const queued = inbox.shift();

    if (queued) {
      return Promise.resolve(queued);
    }

    if (ws.readyState !== WebSocket.OPEN) {
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const idx = waiters.indexOf(onBytes);

        if (idx >= 0) {
          waiters.splice(idx, 1);
        }
        resolve(null);
      }, timeoutMs);
      const onBytes = (bytes: Uint8Array | null) => {
        clearTimeout(timer);
        resolve(bytes);
      };

      waiters.push(onBytes);
    });
  };

  ws.send(hocuspocusAuthBytes(documentName, collabToken));
  const reply = await nextBytes(1500);
  const authVerdict = reply ? readAuthReplyVerdict(reply) : -1;

  return {
    ws,
    authVerdict,
    nextBytes,
    closeWait: (timeoutMs = 1500) => waitForClose(ws, timeoutMs),
  };
}

function readAuthReplyVerdict(bytes: Uint8Array): number {
  const decoder = decoding.createDecoder(bytes);

  decoding.readVarString(decoder);
  decoding.readVarUint(decoder);

  return decoding.readVarUint(decoder);
}

function toUint8(raw: unknown): Uint8Array {
  if (raw instanceof Uint8Array) {
    return raw;
  }

  if (Array.isArray(raw)) {
    return Buffer.concat(raw);
  }

  return new Uint8Array(raw as ArrayBuffer);
}

function initialPoolState(): PoolState {
  return {
    apiTokens: [],
    sessionTokens: [],
    handoffs: new Map(),
    generations: new Map(),
    repos: [repoRow("repo-1", REPO_ALPHA)],
    plans: [],
    planStates: new Map(),
    planVersions: [],
    planCollabTokens: [],
  };
}

function repoRow(id: string, fullName: string): Record<string, unknown> {
  const [owner, name] = fullName.split("/");

  return {
    id,
    owner,
    name,
    fullName,
    onboardedAt: FIXED_NOW.toISOString(),
    onboardingPrUrl: null,
    onboardingPrMerged: false,
    settings: {},
  };
}

function sha256(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function createGithubFetchStub(
  people: Map<string, GithubPerson>,
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
      return githubApiResponse(url, init, people);
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
): Response {
  if (url.pathname === `/app/installations/${INSTALLATION_ID}/access_tokens`) {
    return jsonResponse({
      token: APP_INSTALLATION_TOKEN,
      expires_at: "2026-11-22T20:00:00Z",
    });
  }

  const authorization = new Headers(init?.headers).get("authorization") ?? "";
  const byToken = findPersonByAccessToken(people, authorization);

  if (byToken) {
    return (
      handleUserGithubApi(url.pathname, byToken) ??
      jsonResponse({ message: "Not Found" }, 404)
    );
  }

  return appMembershipResponse(url.pathname, people);
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

function appMembershipResponse(
  pathname: string,
  people: Map<string, GithubPerson>,
): Response {
  const membershipMatch = new RegExp(
    `^/orgs/${GITHUB_ORG}/(?:memberships|members)/([^/]+)$`,
  ).exec(pathname);

  if (!membershipMatch) {
    return jsonResponse({ message: "Not Found" }, 404);
  }

  const found = people.get(decodeURIComponent(membershipMatch[1]));

  return found
    ? jsonResponse({ state: "active", role: "member" })
    : jsonResponse({ message: "Not Found" }, 404);
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
    return jsonResponse({ state: "active", role: "member" });
  }

  if (pathname === `/user/installations/${INSTALLATION_ID}/repositories`) {
    return jsonResponse({
      total_count: person.userRepos.length,
      repositories: person.userRepos.map(toGithubRepoJson),
    });
  }

  return null;
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
    commitPoolState(tx.staged, committed);
    tx.active = false;

    return { rows: [] };
  }

  if (trimmed === "ROLLBACK") {
    tx.active = false;

    return { rows: [] };
  }

  return executePoolSql(tx.active ? tx.staged : committed, trimmed, params);
}

function clonePoolState(source: PoolState): PoolState {
  return {
    apiTokens: source.apiTokens.map((row) => ({ ...row })),
    sessionTokens: source.sessionTokens.map((row) => ({ ...row })),
    handoffs: new Map(
      [...source.handoffs.entries()].map(([key, row]) => [key, { ...row }]),
    ),
    generations: new Map(source.generations),
    repos: source.repos.map((row) => ({ ...row })),
    plans: source.plans.map((row) => ({ ...row })),
    planStates: new Map(
      [...source.planStates.entries()].map(([key, row]) => [key, { ...row }]),
    ),
    planVersions: source.planVersions.map((row) => ({ ...row })),
    planCollabTokens: source.planCollabTokens.map((row) => ({ ...row })),
  };
}

function commitPoolState(source: PoolState, target: PoolState): void {
  target.apiTokens.splice(0, target.apiTokens.length, ...source.apiTokens);
  target.sessionTokens.splice(
    0,
    target.sessionTokens.length,
    ...source.sessionTokens,
  );
  target.handoffs = source.handoffs;
  target.generations = source.generations;
  target.plans.splice(0, target.plans.length, ...source.plans);
  target.planStates = source.planStates;
  target.planVersions.splice(
    0,
    target.planVersions.length,
    ...source.planVersions,
  );
  target.planCollabTokens.splice(
    0,
    target.planCollabTokens.length,
    ...source.planCollabTokens,
  );
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

  if (sql.includes("lore.plan_collab_tokens")) {
    return handlePlanCollabTokensSql(state, sql, params);
  }

  if (sql.includes("pipeline.api_tokens")) {
    return handleApiTokensSql(state, sql, params);
  }

  if (sql.includes("pipeline.user_session_tokens")) {
    return handleSessionTokensSql(state, sql, params);
  }

  return executeSecondarySql(state, sql, params);
}

function executeSecondarySql(
  state: PoolState,
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  if (sql.includes("lore.plan_state") || sql.includes("lore.plans")) {
    return handlePlansSql(state, sql, params);
  }

  if (sql.includes("lore.plan_versions")) {
    return handlePlanVersionsSql(state, sql, params);
  }

  if (sql.includes("FROM lore.repos")) {
    return handleReposSql(state.repos, sql, params);
  }

  return { rows: [] };
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
        accessTokenExpiresAt: row.access_token_expires_at,
        refreshTokenExpiresAt: row.refresh_token_expires_at,
      },
    ],
  };
}

function handlePlanCollabTokensSql(
  state: PoolState,
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  if (sql.includes("INSERT INTO lore.plan_collab_tokens")) {
    const columns = insertColumnsOf(sql, "lore.plan_collab_tokens");

    state.planCollabTokens.push(mapColumns(columns, params));

    return { rows: [] };
  }

  if (sql.includes("DELETE FROM lore.plan_collab_tokens")) {
    return { rows: [] };
  }

  const now = new Date(nowMs());
  const checkSession = sql.includes("pipeline.api_tokens");
  const rows = state.planCollabTokens.filter(
    (row) =>
      collabTokenMatches(row, params, now) &&
      (!checkSession || collabSessionStillActive(state, row, now)),
  );

  return {
    rows: rows.map((row) => ({
      id: row.user_id,
      name: row.user_name,
      role: row.role,
    })),
  };
}

function collabTokenMatches(
  row: Record<string, unknown>,
  params: unknown[],
  now: Date,
): boolean {
  if (
    !valuesMatch(row.token_hash, params[0]) ||
    !valuesMatch(row.plan_id, params[1]) ||
    !valuesMatch(row.repo, params[2])
  ) {
    return false;
  }

  return new Date(row.expires_at as Date | string) > now;
}

function collabSessionStillActive(
  state: PoolState,
  row: Record<string, unknown>,
  now: Date,
): boolean {
  const sessionId = row.session_id;

  if (isNullish(sessionId)) {
    return true;
  }

  const session = state.apiTokens.find((entry) =>
    valuesMatch(entry.id, sessionId),
  );

  if (!session || session.revoked_at !== null) {
    return false;
  }

  return (
    isNullish(session.expires_at) ||
    new Date(session.expires_at as Date | string) > now
  );
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
  const now = new Date(nowMs());
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
  const whereMatch = /WHERE\s+(\w+)\s*=\s*(?:ANY\()?\$(\d+)/i.exec(sql);
  const now = new Date(nowMs());

  return apiTokens.filter(
    (row) =>
      tokenFlagsMatch(row, sql, now) &&
      tokenWhereMatches(row, whereMatch, params),
  );
}

function tokenFlagsMatch(
  row: Record<string, unknown>,
  sql: string,
  now: Date,
): boolean {
  if (sql.includes("revoked_at IS NULL") && row.revoked_at !== null) {
    return false;
  }

  if (sql.includes("kind = 'user'") && row.kind !== "user") {
    return false;
  }

  return !sql.includes("expires_at > now()") || tokenNotExpired(row, now);
}

function tokenNotExpired(row: Record<string, unknown>, now: Date): boolean {
  if (isNullish(row.expires_at)) {
    return true;
  }

  return new Date(row.expires_at as Date | string) > now;
}

function tokenWhereMatches(
  row: Record<string, unknown>,
  whereMatch: RegExpExecArray | null,
  params: unknown[],
): boolean {
  if (!whereMatch) {
    return true;
  }

  const expected = params[Number(whereMatch[2]) - 1];
  const actual = row[whereMatch[1]];

  return Array.isArray(expected)
    ? expected.some((entry) => valuesMatch(actual, entry))
    : valuesMatch(actual, expected);
}

function applyTokenUpdates(
  row: Record<string, unknown>,
  sql: string,
  params: unknown[],
): void {
  const now = new Date(nowMs());
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
    revokedAt: row.revoked_at,
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
    purgeSessionTokens(state, sql, params);

    return { rows: [] };
  }

  return selectSessionTokens(state, params);
}

function selectSessionTokens(
  state: PoolState,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  const stored = state.sessionTokens.find((entry) =>
    valuesMatch(entry.token_id, params[0]),
  );

  if (!stored) {
    return { rows: [] };
  }

  return {
    rows: [
      {
        encryptedTokens: stored.encrypted_tokens,
        accessTokenExpiresAt: stored.access_token_expires_at,
      },
    ],
  };
}

function purgeSessionTokens(
  state: PoolState,
  sql: string,
  params: unknown[],
): void {
  const whereMatch = /WHERE\s+(\w+)\s*=\s*\$(\d+)/i.exec(sql);

  if (!whereMatch) {
    return;
  }

  const expected = params[Number(whereMatch[2]) - 1];
  const kept = state.sessionTokens.filter(
    (entry) => !valuesMatch(entry[whereMatch[1]], expected),
  );

  state.sessionTokens.splice(0, state.sessionTokens.length, ...kept);
}

function handlePlansSql(
  state: PoolState,
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  if (sql.includes("INSERT INTO lore.plans")) {
    return insertPlanRow(state.plans, params);
  }

  if (sql.includes("INSERT INTO lore.plan_state")) {
    state.planStates.set(String(params[0]), {
      plan_id: params[0],
      state: params[1],
      json: params[2],
      content_hash: params[3],
    });

    return { rows: [] };
  }

  if (sql.includes("SELECT s.json, s.content_hash")) {
    return selectPlanProjection(state, String(params[0]));
  }

  if (sql.includes("SELECT state FROM lore.plan_state")) {
    const found = state.planStates.get(String(params[0]));

    return { rows: found ? [{ state: found.state }] : [] };
  }

  return selectPlanRows(state.plans, sql, params);
}

function insertPlanRow(
  plans: Array<Record<string, unknown>>,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  const now = new Date(nowMs());
  const row: Record<string, unknown> = {
    id: randomUUID(),
    repo: params[0],
    title: params[1],
    type: params[2],
    status: "draft",
    created_by: params[3],
    created_at: now,
    updated_at: now,
    story_issue: params[4] ?? null,
    spec_path: params[5] ?? null,
  };

  plans.push(row);

  return { rows: [planMetaRow(row)] };
}

function selectPlanProjection(
  state: PoolState,
  planId: string,
): { rows: Array<Record<string, unknown>> } {
  const meta = state.plans.find((entry) => entry.id === planId);
  const planState = state.planStates.get(planId);

  if (!meta || !planState) {
    return { rows: [] };
  }

  return {
    rows: [
      {
        ...planMetaRow(meta),
        json: planState.json,
        content_hash: planState.content_hash,
      },
    ],
  };
}

function selectPlanRows(
  plans: Array<Record<string, unknown>>,
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  if (sql.includes("WHERE id = $1")) {
    const found = plans.find((entry) => entry.id === String(params[0]));

    return { rows: found ? [planMetaRow(found)] : [] };
  }

  return { rows: plans.map(planMetaRow) };
}

function planMetaRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    repo: row.repo,
    title: row.title,
    type: row.type,
    status: row.status,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    story_issue: row.story_issue,
    spec_path: row.spec_path,
  };
}

function handlePlanVersionsSql(
  state: PoolState,
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  if (sql.includes("INSERT INTO lore.plan_versions")) {
    state.planVersions.push({ plan_id: params[0], version: params[1] });
  }

  return { rows: [] };
}

function handleReposSql(
  repos: Array<Record<string, unknown>>,
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  if (sql.includes("WHERE owner = $1 AND name = $2")) {
    return {
      rows: repos.filter(
        (repo) => repo.owner === params[0] && repo.name === params[1],
      ),
    };
  }

  return { rows: repos };
}

function insertColumnsOf(sql: string, tableName: string): string[] {
  const pattern = new RegExp(
    `INSERT INTO ${tableName.replace(".", "\\.")}\\s*\\(([\\s\\S]+?)\\)\\s*VALUES`,
    "i",
  );
  const match = pattern.exec(sql);

  return match ? match[1].split(",").map((column) => column.trim()) : [];
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

function valuesMatch(left: unknown, right: unknown): boolean {
  return left === right || String(left) === String(right);
}

function isNullish(value: unknown): boolean {
  return value === null || value === undefined;
}
