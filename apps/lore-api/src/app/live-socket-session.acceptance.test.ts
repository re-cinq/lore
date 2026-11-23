import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { AuthMessageType, writeAuthentication } from "@hocuspocus/common";
import { makePool } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import {
  collabAuthenticator,
  mintCollabToken,
} from "../work/plans/collab-tokens.js";
import { mountLiveSocket } from "../work/assembly-line-station/live-socket.js";
import {
  cookieOf,
  queuedClient,
} from "../work/assembly-line-station/live-socket.fixtures.js";
import {
  base64ToBytes,
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
const ADMIN_TOKEN = "live-socket-admin-token";
const ENCRYPTION_KEY = "0123456789abcdef".repeat(4);
const APP_INSTALLATION_TOKEN = "ghs_app_install_token";
const HOCUSPOCUS_AUTH_MESSAGE = 2;
const REPO_ALPHA = "acme-org/alpha";
const REPO_BETA = "acme-org/beta";
const RUN_ALPHA_ID = "00000000-0000-4000-8000-000000000001";
const RUN_BETA_ID = "00000000-0000-4000-8000-000000000002";

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
  userMembershipStatus: number;
  appMembershipStatus: number;
  userRepos: string[];
}

interface RecordedMembershipCall {
  path: string;
  authorization: string;
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
  assemblyRuns: Array<Record<string, unknown>>;
  plans: Array<Record<string, unknown>>;
  planStates: Map<string, Record<string, unknown>>;
  planVersions: Array<Record<string, unknown>>;
  planCollabTokens: Array<Record<string, unknown>>;
  genericTables: Map<string, Array<Record<string, unknown>>>;
}

describe("Live connections follow the session (FR-279 to FR-301)", () => {
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

  it("closes every live socket opened with a session when that session ends on sign-out, revocation by row id, or removal from the organisation, leaving other sessions open", async () => {
    const harness = await startedHarness([
      makePerson(987654, "alice"),
      makePerson(555666, "bob"),
    ]);

    activeHarnesses.push(harness);
    const aliceSessionOne = await signInPerson(harness, "alice");
    const aliceSessionTwo = await signInPerson(harness, "alice");
    const bobSession = await signInPerson(harness, "bob");
    const wsAlice1a = await harness.connect(aliceSessionOne);
    const wsAlice1b = await harness.connect(aliceSessionOne);
    const wsAlice2 = await harness.connect(aliceSessionTwo);
    const wsBob = await harness.connect(bobSession);
    const wsAnon = await harness.connect();

    const signOutOutcome = await closeAfterSignOut(harness, aliceSessionOne, {
      wsAlice1a,
      wsAlice1b,
      wsAlice2,
      wsBob,
      wsAnon,
    });
    const aliceSessionTwoId = await sessionRowIdOf(harness, aliceSessionTwo);
    const revokeByIdOutcome = await closeAfterIdRevoke(
      harness,
      aliceSessionTwoId,
      wsAlice2,
      wsBob,
    );
    const removalOutcome = await closeAfterOrgRemoval(harness, wsBob);

    expect({
      mountReady: typeof mountLiveSocket === "function",
      signOutOutcome,
      revokeByIdOutcome,
      removalOutcome,
    }).toEqual({
      mountReady: true,
      signOutOutcome: {
        alice1aClosed: true,
        alice1bClosed: true,
        alice2MeStatus: 200,
        bobMeStatus: 200,
        anonOpenReadyState: WebSocket.OPEN,
      },
      revokeByIdOutcome: {
        alice2Closed: true,
        bobMeStatus: 200,
      },
      removalOutcome: {
        alice3Closed: true,
        bobMeStatus: 200,
      },
    });
  }, 30_000);

  it("checks a stale session again before accepting or serving a frame on a live socket, closing the socket when the person is no longer an active member", async () => {
    const harness = await startedHarness([makePerson(987654, "alice")]);

    activeHarnesses.push(harness);
    const planId = await createPlan(harness, REPO_ALPHA, "alice");
    const documentName = `plan:${REPO_ALPHA}:${planId}`;

    const serving = await probeRemovedMemberOnServe(
      harness,
      planId,
      documentName,
    );
    const accepting = await probeRemovedMemberOnAccept(
      harness,
      planId,
      documentName,
    );

    expect({ serving, accepting }).toEqual({
      serving: {
        freshMeStatus: 200,
        freshMembershipCalls: 0,
        staleMembershipCalls: 1,
        closedOnServe: true,
        deliveredDataAfterRemoval: false,
        sessionRevoked: true,
      },
      accepting: {
        staleMembershipCallsDelta: 1,
        closedOnAccept: true,
        sessionRevoked: true,
      },
    });
  }, 30_000);

  it("closes only channels on repositories the person can no longer read after the five-minute session check, keeping the socket and readable channels open", async () => {
    const harness = await startedHarness([makePerson(987654, "alice")]);

    activeHarnesses.push(harness);
    const aliceSession = await signInPerson(harness, "alice");
    const ws = await harness.connect(aliceSession);

    await openRunAndCatchUp(ws, "r-alpha", RUN_ALPHA_ID);
    await openRunAndCatchUp(ws, "r-beta", RUN_BETA_ID);

    vi.setSystemTime(nowMs() + 6 * 60_000);
    harness.setPersonRepos("alice", [REPO_BETA]);
    ws.send({
      type: "request",
      id: "probe-beta",
      method: "GET",
      path: `/api/repos/${REPO_BETA}/plans`,
    });
    const probeReply = await nextResponse(ws, "probe-beta");

    ws.send({ type: "close", channel: "r-beta" });
    const betaClosed = await nextClosedFor(ws, "r-beta");
    const alphaClosed = ws.seen.find(
      (msg) => msg.type === "closed" && msg.channel === "r-alpha",
    );

    expect({
      probeStatus: probeReply.status,
      alphaClosed: alphaClosed ?? null,
      betaClosed,
      socketReadyState: ws.ws.readyState,
    }).toEqual({
      probeStatus: 200,
      alphaClosed: {
        type: "closed",
        channel: "r-alpha",
        reason: "unauthorized",
      },
      betaClosed: { type: "closed", channel: "r-beta", reason: "client" },
      socketReadyState: WebSocket.OPEN,
    });
  }, 30_000);

  it("closes a live socket with a reconnectable reason and keeps the session when GitHub gives no answer at the five-minute check", async () => {
    const harness = await startedHarness([makePerson(987654, "alice")]);

    activeHarnesses.push(harness);
    const aliceSession = await signInPerson(harness, "alice");
    const ws = await harness.connect(aliceSession);

    const outage = await probeGithubOutageOnStaleSocket(
      harness,
      aliceSession,
      ws,
    );

    expect(outage).toEqual({
      freshStatus: 200,
      closed: true,
      reconnectable: true,
      sessionKept: true,
      recoveredStatus: 200,
    });
  }, 30_000);

  it("records the minting session on a plan collaboration token and refuses it once that session ends while keeping tokens of other active sessions valid", async () => {
    const harness = await startedHarness([makePerson(987654, "alice")]);

    activeHarnesses.push(harness);
    const planId = await createPlan(harness, REPO_ALPHA, "alice");
    const documentName = `plan:${REPO_ALPHA}:${planId}`;
    const aliceSessionOne = await signInPerson(harness, "alice");
    const aliceSessionTwo = await signInPerson(harness, "alice");

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

    const beforeLogout = await authenticateCollabPair(
      harness,
      aliceSessionTwo,
      documentName,
      { collabOne, collabTwo },
    );

    await callApi(harness.server, {
      method: "POST",
      url: "/api/auth/logout",
      token: aliceSessionOne,
    });

    const afterLogoutOne = await authenticateCollabPair(
      harness,
      aliceSessionTwo,
      documentName,
      { collabOne, collabTwo },
    );
    const directAfterLogoutOne = await collabAuthenticator(
      () => harness.pool as never,
    ).authenticate(collabOne, { repo: REPO_ALPHA, planId });

    await callApi(harness.server, {
      method: "POST",
      url: "/api/auth/logout",
      token: aliceSessionTwo,
    });
    const directAfterLogoutTwo = await collabAuthenticator(
      () => harness.pool as never,
    ).authenticate(collabTwo, { repo: REPO_ALPHA, planId });

    expect({
      mintCollabExported: typeof mintCollabToken === "function",
      beforeLogout,
      afterLogoutOne,
      directAfterLogoutOne,
      directAfterLogoutTwo,
    }).toEqual({
      mintCollabExported: true,
      beforeLogout: [
        AuthMessageType.Authenticated,
        AuthMessageType.Authenticated,
      ],
      afterLogoutOne: [
        AuthMessageType.PermissionDenied,
        AuthMessageType.Authenticated,
      ],
      directAfterLogoutOne: null,
      directAfterLogoutTwo: null,
    });
  }, 30_000);
});

async function startedHarness(people: GithubPerson[]) {
  const harness = createHarness(people);

  await harness.server.start();
  harness.setPort(Number(harness.server.info.port));

  return harness;
}

async function probeGithubOutageOnStaleSocket(
  harness: ReturnType<typeof createHarness>,
  aliceSession: string,
  ws: TrackedClient,
) {
  const freshStatus = (await sendRequest(ws, "fresh", "GET", "/api/repos"))
    .status;

  return {
    freshStatus,
    ...(await disconnectOnGithubOutage(harness, aliceSession, ws)),
  };
}

async function disconnectOnGithubOutage(
  harness: ReturnType<typeof createHarness>,
  aliceSession: string,
  ws: TrackedClient,
) {
  const closePromise = waitForClose(ws.ws, 1500);

  vi.setSystemTime(nowMs() + 6 * 60_000);
  harness.setPersonMembership("alice", { appMembershipStatus: 500 });
  ws.send({
    type: "request",
    id: "stale-outage",
    method: "GET",
    path: "/api/repos",
  });
  const closed = await closePromise;

  harness.setPersonMembership("alice", { appMembershipStatus: 200 });
  const recoveredWs = await harness.connect(aliceSession);
  const recoveredReply = await sendRequest(
    recoveredWs,
    "after-recovery",
    "GET",
    "/api/repos",
  );

  return {
    closed: closed.closed,
    reconnectable: isReconnectableClose(closed),
    sessionKept: !harness.isTokenRevoked(aliceSession),
    recoveredStatus: recoveredReply.status,
  };
}

async function closeAfterSignOut(
  harness: ReturnType<typeof createHarness>,
  aliceSessionOne: string,
  sockets: {
    wsAlice1a: TrackedClient;
    wsAlice1b: TrackedClient;
    wsAlice2: TrackedClient;
    wsBob: TrackedClient;
    wsAnon: TrackedClient;
  },
) {
  const close1a = waitForClose(sockets.wsAlice1a.ws, 1000);
  const close1b = waitForClose(sockets.wsAlice1b.ws, 1000);

  await callApi(harness.server, {
    method: "POST",
    url: "/api/auth/logout",
    token: aliceSessionOne,
  });
  const [closed1a, closed1b] = await Promise.all([close1a, close1b]);
  const alice2Me = await sendRequest(
    sockets.wsAlice2,
    "a2-me",
    "GET",
    "/api/repos",
  );
  const bobMe = await sendRequest(
    sockets.wsBob,
    "bob-me-1",
    "GET",
    "/api/repos",
  );

  return {
    alice1aClosed: closed1a.closed,
    alice1bClosed: closed1b.closed,
    alice2MeStatus: alice2Me.status,
    bobMeStatus: bobMe.status,
    anonOpenReadyState: sockets.wsAnon.ws.readyState,
  };
}

async function closeAfterIdRevoke(
  harness: ReturnType<typeof createHarness>,
  aliceSessionTwoId: string,
  wsAlice2: TrackedClient,
  wsBob: TrackedClient,
) {
  const close2 = waitForClose(wsAlice2.ws, 1000);

  await callApi(harness.server, {
    method: "POST",
    url: "/api/tokens",
    token: ADMIN_TOKEN,
    payload: { action: "revoke", token_id: aliceSessionTwoId },
  });
  const closed2 = await close2;
  const bobMe = await sendRequest(wsBob, "bob-me-2", "GET", "/api/repos");

  return { alice2Closed: closed2.closed, bobMeStatus: bobMe.status };
}

async function closeAfterOrgRemoval(
  harness: ReturnType<typeof createHarness>,
  wsBob: TrackedClient,
) {
  const aliceSessionThree = await signInPerson(harness, "alice");
  const aliceMinted = await mintUserToken(
    harness,
    aliceSessionThree,
    "alice-minted",
  );
  const wsAlice3 = await harness.connect(aliceSessionThree);
  const close3 = waitForClose(wsAlice3.ws, 1000);

  vi.setSystemTime(nowMs() + 6 * 60_000);
  harness.setPersonMembership("alice", { appMembershipStatus: 404 });
  await callApi(harness.server, {
    method: "GET",
    url: "/api/repos",
    token: aliceMinted,
  });
  const closed3 = await close3;
  const bobMe = await sendRequest(wsBob, "bob-me-3", "GET", "/api/repos");

  return { alice3Closed: closed3.closed, bobMeStatus: bobMe.status };
}

async function probeRemovedMemberOnServe(
  harness: ReturnType<typeof createHarness>,
  planId: string,
  documentName: string,
) {
  const aliceSession = await signInPerson(harness, "alice");
  const collabToken = await mintCollabForSession(harness, planId, aliceSession);
  const ws = await harness.connect(aliceSession);

  await openAuthenticatedPlanChannel(ws, "p", documentName, collabToken);
  const freshMeStatus = (await sendRequest(ws, "fresh-me", "GET", "/api/repos"))
    .status;
  const freshMembershipCalls = harness.appMembershipCalls().length;
  const stale = await triggerServeAfterRemoval(harness, ws, planId);

  return {
    freshMeStatus,
    freshMembershipCalls,
    ...stale,
    sessionRevoked: harness.isTokenRevoked(aliceSession),
  };
}

async function triggerServeAfterRemoval(
  harness: ReturnType<typeof createHarness>,
  ws: TrackedClient,
  planId: string,
) {
  const receivedBefore = ws.received.length;
  const closePromise = waitForClose(ws.ws, 1500);

  vi.setSystemTime(nowMs() + 6 * 60_000);
  harness.setPersonMembership("alice", { appMembershipStatus: 404 });
  await callApi(harness.server, {
    method: "POST",
    url: `/api/plans/${planId}/agent-presence`,
    token: ADMIN_TOKEN,
    payload: { user: { name: "Planner", color: "#111111" } },
  });
  const closed = await closePromise;

  return {
    staleMembershipCalls: harness.appMembershipCalls().length,
    closedOnServe: closed.closed,
    deliveredDataAfterRemoval: ws.received
      .slice(receivedBefore)
      .some((msg) => msg.type === "data" && msg.channel === "p"),
  };
}

async function probeRemovedMemberOnAccept(
  harness: ReturnType<typeof createHarness>,
  planId: string,
  documentName: string,
) {
  harness.setPersonMembership("alice", { appMembershipStatus: 200 });
  const aliceSession = await signInPerson(harness, "alice");
  const collabToken = await mintCollabForSession(harness, planId, aliceSession);
  const ws = await harness.connect(aliceSession);

  await openAuthenticatedPlanChannel(ws, "p", documentName, collabToken);
  const callsBefore = harness.appMembershipCalls().length;

  vi.setSystemTime(nowMs() + 6 * 60_000);
  harness.setPersonMembership("alice", { appMembershipStatus: 404 });
  const closePromise = waitForClose(ws.ws, 1500);

  ws.send({
    type: "send",
    channel: "p",
    data: hocuspocusAuthMessage(documentName, collabToken),
  });
  const closed = await closePromise;

  return {
    staleMembershipCallsDelta:
      harness.appMembershipCalls().length - callsBefore,
    closedOnAccept: closed.closed,
    sessionRevoked: harness.isTokenRevoked(aliceSession),
  };
}

async function authenticateCollabPair(
  harness: ReturnType<typeof createHarness>,
  sessionToken: string,
  documentName: string,
  tokens: { collabOne: string; collabTwo: string },
): Promise<number[]> {
  const ws = await harness.connect(sessionToken);

  ws.send({ type: "open", channel: "c1", kind: "plan", subject: documentName });
  await nextOn(ws, "c1");
  ws.send({
    type: "send",
    channel: "c1",
    data: hocuspocusAuthMessage(documentName, tokens.collabOne),
  });
  const replyOne = await nextOn(ws, "c1");

  ws.send({ type: "open", channel: "c2", kind: "plan", subject: documentName });
  await nextOn(ws, "c2");
  ws.send({
    type: "send",
    channel: "c2",
    data: hocuspocusAuthMessage(documentName, tokens.collabTwo),
  });
  const replyTwo = await nextOn(ws, "c2");

  return [authVerdictOf(replyOne), authVerdictOf(replyTwo)];
}

function authVerdictOf(message: LiveServerMessage): number {
  if (message.type !== "data") {
    return -1;
  }
  const decoder = decoding.createDecoder(base64ToBytes(message.data));

  decoding.readVarString(decoder);
  decoding.readVarUint(decoder);

  return decoding.readVarUint(decoder);
}

function hocuspocusAuthMessage(documentName: string, token: string): string {
  const encoder = encoding.createEncoder();

  encoding.writeVarString(encoder, documentName);
  encoding.writeVarUint(encoder, HOCUSPOCUS_AUTH_MESSAGE);
  writeAuthentication(encoder, token);

  return bytesToBase64(encoding.toUint8Array(encoder));
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

async function openRunAndCatchUp(
  ws: TrackedClient,
  channel: string,
  runId: string,
): Promise<void> {
  ws.send({ type: "open", channel, kind: "run", subject: runId });

  for (;;) {
    const message = await nextOn(ws, channel);

    if (message.type === "closed") {
      throw new Error(`run channel ${channel} closed early: ${message.reason}`);
    }

    if (message.type === "frame" && message.frame.type === "catchup_complete") {
      return;
    }
  }
}

async function sendRequest(
  ws: TrackedClient,
  id: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
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

async function nextClosedFor(ws: TrackedClient, channel: string) {
  for (;;) {
    const message = await nextOn(ws, channel);

    if (message.type === "closed") {
      return message;
    }
  }
}

async function nextOn(ws: TrackedClient, channel: string) {
  for (;;) {
    const message = await ws.next();

    if ("channel" in message && message.channel === channel) {
      return message;
    }
  }
}

function isReconnectableClose(outcome: CloseOutcome): boolean {
  if (!outcome.closed) {
    return false;
  }

  return (
    outcome.code === 1012 ||
    outcome.code === 1013 ||
    /retry|reconnect|again/i.test(outcome.reason)
  );
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

  return (res.result as { meta: { id: string } }).meta.id;
}

async function mintCollabForSession(
  harness: ReturnType<typeof createHarness>,
  planId: string,
  sessionToken: string,
): Promise<string> {
  const res = await callApi(harness.server, {
    method: "POST",
    url: `/api/repos/${REPO_ALPHA}/plans/${planId}/collab-token`,
    token: sessionToken,
    payload: { user: { id: "alice", name: "ALICE" }, role: "write" },
  });

  return (res.result as { token: string }).token;
}

async function sessionRowIdOf(
  harness: ReturnType<typeof createHarness>,
  sessionToken: string,
): Promise<string> {
  const res = await callApi(harness.server, {
    method: "GET",
    url: "/api/tokens?limit=100",
    token: ADMIN_TOKEN,
  });
  const hash = sha256(sessionToken);
  const row = harness.apiTokens().find((entry) => entry.token_hash === hash);
  const listed = (res.result as { tokens: Array<{ id: string }> }).tokens.find(
    (entry) => entry.id === row?.id,
  );

  return listed?.id ?? String(row?.id ?? "");
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

async function mintUserToken(
  harness: ReturnType<typeof createHarness>,
  sessionToken: string,
  name: string,
): Promise<string> {
  const res = await callApi(harness.server, {
    method: "POST",
    url: "/api/tokens",
    token: sessionToken,
    payload: { name, scopes: ["read"] },
  });

  return (res.result as { token: string }).token;
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

type TrackedClient = Awaited<
  ReturnType<ReturnType<typeof createHarness>["connect"]>
>;

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
    userRepos: [REPO_ALPHA, REPO_BETA],
    ...overrides,
  };
}

function nowMs(): number {
  return new Date().getTime();
}

function createHarness(initialPeople: GithubPerson[]) {
  const people = new Map(initialPeople.map((person) => [person.login, person]));
  const membershipCalls: RecordedMembershipCall[] = [];
  const sockets: WebSocket[] = [];
  let port = 0;
  const state = initialPoolState();
  const pool = createFakePool(state);

  globalThis.fetch = createGithubFetchStub(people, membershipCalls);
  const server = buildServer(() => pool as never);

  return {
    server,
    pool,
    setPort: (nextPort: number) => {
      port = nextPort;
    },
    apiTokens: () => state.apiTokens,
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
    setPersonRepos: (login: string, repos: string[]) => {
      const person = people.get(login);

      if (person) {
        person.userRepos = repos;
      }
    },
    connect: async (sessionToken?: string) => {
      const headers = sessionToken
        ? cookieOf(sessionToken)
        : { origin: UI_URL };
      const client = queuedClient(port, "/api/ws", headers);
      const seen: LiveServerMessage[] = [];
      const received: LiveServerMessage[] = [];
      const baseNext = client.next;

      client.ws.on("message", (raw) => {
        received.push(JSON.parse(raw.toString()) as LiveServerMessage);
      });
      sockets.push(client.ws);
      await client.open();

      return {
        ...client,
        seen,
        received,
        next: async () => {
          const message = await baseNext();

          seen.push(message);

          return message;
        },
      };
    },
    stop: async () => {
      for (const ws of sockets.splice(0)) {
        ws.terminate();
      }
      await server.stop();
    },
  };
}

function initialPoolState(): PoolState {
  const created = new Date(nowMs());

  return {
    apiTokens: [],
    sessionTokens: [],
    handoffs: new Map(),
    generations: new Map(),
    repos: [repoRow("repo-1", REPO_ALPHA), repoRow("repo-2", REPO_BETA)],
    assemblyRuns: [
      runRow(RUN_ALPHA_ID, REPO_ALPHA, created),
      runRow(RUN_BETA_ID, REPO_BETA, created),
    ],
    plans: [],
    planStates: new Map(),
    planVersions: [],
    planCollabTokens: [],
    genericTables: new Map(),
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

function runRow(
  id: string,
  repo: string,
  createdAt: Date,
): Record<string, unknown> {
  return {
    id,
    graph: { nodes: [], edges: [] },
    blueprint_name: "implementation",
    task_id: null,
    repo,
    branch: "main",
    subject_key: null,
    args: {},
    status: "running",
    outcome: null,
    reason: null,
    blueprint_hash: null,
    resumed_from_run_id: null,
    resumed_from_node_id: null,
    inherited_node_count: 0,
    created_at: createdAt,
    started_at: createdAt,
    finished_at: null,
  };
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

  const authorization = new Headers(init?.headers).get("authorization") ?? "";
  const byToken = [...people.values()].find(
    (person) =>
      authorization === `Bearer ${person.userAccessToken}` ||
      authorization === `token ${person.userAccessToken}`,
  );
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
    return statusResponse(person.userMembershipStatus);
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
  const membershipMatch = new RegExp(
    `^/orgs/${GITHUB_ORG}/(?:memberships|members)/([^/]+)$`,
  ).exec(pathname);

  if (!membershipMatch) {
    return jsonResponse({ message: "Not Found" }, 404);
  }

  membershipCalls.push({ path: pathname, authorization });
  const person = people.get(decodeURIComponent(membershipMatch[1]));

  return statusResponse(person?.appMembershipStatus ?? 404);
}

function statusResponse(status: number): Response {
  if (status >= 400) {
    return jsonResponse({ message: "Error" }, status);
  }

  return jsonResponse({ state: "active", role: "member" });
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
    assemblyRuns: source.assemblyRuns.map((row) => ({ ...row })),
    plans: source.plans.map((row) => ({ ...row })),
    planStates: new Map(
      [...source.planStates.entries()].map(([key, row]) => [key, { ...row }]),
    ),
    planVersions: source.planVersions.map((row) => ({ ...row })),
    planCollabTokens: source.planCollabTokens.map((row) => ({ ...row })),
    genericTables: new Map(source.genericTables),
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

  if (isSessionTokenSql(sql)) {
    return handleSessionTokensSql(state, sql, params);
  }

  if (sql.includes("pipeline.api_tokens")) {
    return handleApiTokensSql(state, sql, params);
  }

  return executeSecondarySql(state, sql, params);
}

function isSessionTokenSql(sql: string): boolean {
  return (
    sql.includes("pipeline.user_session_tokens") &&
    !sql.trimStart().startsWith("UPDATE pipeline.api_tokens")
  );
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

  if (sql.includes("pipeline.assembly_runs")) {
    return handleAssemblyRunsSql(state.assemblyRuns, sql, params);
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
    return deletePlanCollabTokens(state, sql, params);
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

function deletePlanCollabTokens(
  state: PoolState,
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  const now = new Date(nowMs());

  if (sql.includes("expires_at < now()")) {
    const kept = state.planCollabTokens.filter(
      (row) => new Date(row.expires_at as Date | string) >= now,
    );

    state.planCollabTokens.splice(0, state.planCollabTokens.length, ...kept);

    return { rows: [] };
  }

  if (params.length > 0) {
    const kept = state.planCollabTokens.filter(
      (row) => !matchesSessionParam(row, params[0]),
    );

    state.planCollabTokens.splice(0, state.planCollabTokens.length, ...kept);
  }

  return { rows: [] };
}

function matchesSessionParam(
  row: Record<string, unknown>,
  param: unknown,
): boolean {
  const value = row.session_id;

  if (Array.isArray(param)) {
    return param.some((entry) => valuesMatch(value, entry));
  }

  return valuesMatch(value, param);
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

  if (sql.includes("UPDATE pipeline.user_session_tokens")) {
    return replaceSessionTokens(state, params);
  }

  return selectSessionTokens(state, params);
}

function replaceSessionTokens(
  state: PoolState,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  const [tokenId, encryptedTokens, accessExpiry, refreshExpiry] = params;
  const stored = state.sessionTokens.find((row) =>
    valuesMatch(row.token_id, tokenId),
  );

  Object.assign(stored ?? {}, {
    encrypted_tokens: encryptedTokens,
    access_token_expires_at: accessExpiry,
    refresh_token_expires_at: refreshExpiry,
  });

  return { rows: [] };
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
    approval: null,
    current_version: 0,
    created_by: params[3],
    created_at: now,
    updated_at: now,
  };

  plans.push(row);

  return { rows: [row] };
}

function selectPlanProjection(
  state: PoolState,
  planId: string,
): { rows: Array<Record<string, unknown>> } {
  const plan = state.plans.find((entry) => valuesMatch(entry.id, planId));
  const stored = state.planStates.get(planId);

  if (!plan || !stored) {
    return { rows: [] };
  }

  return {
    rows: [
      {
        json: stored.json,
        content_hash: stored.content_hash,
        current_version: plan.current_version,
      },
    ],
  };
}

function selectPlanRows(
  plans: Array<Record<string, unknown>>,
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  if (sql.includes("UPDATE lore.plans")) {
    const plan = plans.find((entry) => valuesMatch(entry.id, params[0]));

    return { rows: touchPlan(plan) };
  }

  if (sql.includes("WHERE id = $1")) {
    return { rows: plans.filter((entry) => valuesMatch(entry.id, params[0])) };
  }

  if (sql.includes("WHERE repo = ANY($1)")) {
    const allowed = (params[0] as string[] | undefined) ?? [];

    return {
      rows: plans.filter((entry) => allowed.includes(String(entry.repo))),
    };
  }

  return { rows: plans.filter((entry) => valuesMatch(entry.repo, params[0])) };
}

function touchPlan(
  plan: Record<string, unknown> | undefined,
): Array<Record<string, unknown>> {
  if (!plan) {
    return [];
  }

  plan.updated_at = new Date(nowMs());

  return [plan];
}

function handlePlanVersionsSql(
  state: PoolState,
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  if (sql.includes("INSERT INTO lore.plan_versions")) {
    const columns = insertColumnsOf(sql, "lore.plan_versions");

    state.planVersions.push(mapColumns(columns, params));

    return { rows: [] };
  }

  return {
    rows: state.planVersions.filter((entry) =>
      valuesMatch(entry.plan_id, params[0]),
    ),
  };
}

function handleAssemblyRunsSql(
  runs: Array<Record<string, unknown>>,
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  if (!sql.includes("WHERE id = $1")) {
    return { rows: [] };
  }

  return {
    rows: runs.filter((entry) => valuesMatch(entry.id, params[0])),
  };
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
