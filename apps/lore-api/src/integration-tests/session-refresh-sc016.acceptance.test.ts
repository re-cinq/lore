import { randomBytes } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import type { Server } from "@hapi/hapi";
import pg from "pg";
import { WebSocket } from "ws";
import { setPool } from "@re-cinq/lore-server-core/platform/db.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { buildServer } from "../app/build-server.js";
import { decryptTokenPair } from "../work/auth/token-cipher.js";
import { hashToken } from "../work/tokens/mint-token.js";
import {
  cookieOf,
  queuedClient,
} from "../work/assembly-line-station/live-socket.fixtures.js";
import { restoreEnv } from "./restore-env.js";

const API_URL = "http://localhost:3001";
const UI_URL = "http://localhost:3000";
const GITHUB_ORG = "acme";
const REPO = "acme/sc016-repo";
const INSTALLATION_ID = "42";
const ADMIN_TOKEN = "sc016-admin-token";
const ENCRYPTION_KEY = randomBytes(32).toString("base64");
const CLOSE_WAIT_MS = 3000;
const INITIAL_ACCESS_TOKEN = "ghu_sc016_initial";
const INITIAL_REFRESH_TOKEN = "ghr_sc016_initial";

type RefreshMode =
  | { kind: "rotate"; accessToken: string; refreshToken: string }
  | { kind: "refuse" }
  | { kind: "5xx" }
  | { kind: "timeout" }
  | { kind: "incomplete-2xx" }
  | { kind: "never-left" };

interface GithubTrace {
  refreshCalls: number;
  fileAuthHeaders: string[];
  repoListAuthHeaders: string[];
  mode: RefreshMode;
  nextGithubId: number;
}

describe("Refreshed session lifetime and termination (SC-016)", () => {
  restoreEnv();

  let pool: pg.Pool;
  let server: Server;
  const createdTokenIds: string[] = [];
  const createdGithubIds: number[] = [];
  const sockets: WebSocket[] = [];
  const trace: GithubTrace = {
    refreshCalls: 0,
    fileAuthHeaders: [],
    repoListAuthHeaders: [],
    mode: {
      kind: "rotate",
      accessToken: "ghu_sc016_rotated_1",
      refreshToken: "ghr_sc016_rotated_1",
    },
    nextGithubId: 990400,
  };

  beforeAll(async () => {
    configureIntegrationEnv();
    pool = createTestPool();
    setPool(pool);
    server = buildServer(() => pool, 0);
    await server.start();
  }, 30_000);

  beforeEach(() => {
    trace.refreshCalls = 0;
    trace.fileAuthHeaders = [];
    trace.repoListAuthHeaders = [];
    trace.mode = {
      kind: "rotate",
      accessToken: "ghu_sc016_rotated_1",
      refreshToken: "ghr_sc016_rotated_1",
    };
    installGithubFetch(trace);
  });

  afterEach(() => {
    for (const ws of sockets.splice(0)) {
      ws.terminate();
    }
  });

  afterAll(async () => {
    setPool(null as never);

    if (server) {
      await server.stop();
    }

    await cleanupDatabase(pool, createdTokenIds, createdGithubIds);
  }, 30_000);

  it("keeps an expired session working across its callers without a new sign-in while its refresh token is valid", async () => {
    const session = await signInOverHttp({
      server,
      pool,
      trace,
      createdTokenIds,
      createdGithubIds,
    });

    await markSessionCheckFresh(pool, session.sessionId);
    trace.repoListAuthHeaders = [];
    await expireAccessToken(pool, session.sessionId);

    const fileResponse = await callWithBearer(server, {
      method: "GET",
      url: `/api/repos/${REPO}/github/file?path=README.md`,
      token: session.sessionToken,
    });

    trace.mode = {
      kind: "rotate",
      accessToken: "ghu_sc016_rotated_2",
      refreshToken: "ghr_sc016_rotated_2",
    };
    await expireAccessToken(pool, session.sessionId);
    await markRepoListStale(pool, session.sessionId);

    const reposResponse = await callWithBearer(server, {
      method: "GET",
      url: "/api/repos",
      token: session.sessionToken,
    });
    const stored = await readSessionState(pool, session.sessionId);

    expect({
      fileStatus: fileResponse.statusCode,
      fileBody: fileResponse.result,
      reposStatus: reposResponse.statusCode,
      fileAuthHeaders: trace.fileAuthHeaders,
      repoListAuthHeaders: trace.repoListAuthHeaders,
      refreshCalls: trace.refreshCalls,
      revoked: stored.revoked,
      accessFresh: stored.accessFresh,
      refreshFresh: stored.refreshFresh,
      storedPair: stored.pair,
    }).toEqual({
      fileStatus: 200,
      fileBody: { content: "hello from github" },
      reposStatus: 200,
      fileAuthHeaders: ["Bearer ghu_sc016_rotated_1"],
      repoListAuthHeaders: ["Bearer ghu_sc016_rotated_2"],
      refreshCalls: 2,
      revoked: false,
      accessFresh: true,
      refreshFresh: true,
      storedPair: {
        accessToken: "ghu_sc016_rotated_2",
        expiresIn: 28800,
        refreshToken: "ghr_sc016_rotated_2",
        refreshTokenExpiresIn: 15897600,
      },
    });
  });

  it("ends the session, deletes stored tokens, closes open live sockets, and refuses later requests with 401 when GitHub refuses the refresh token", async () => {
    const session = await signInOverHttp({
      server,
      pool,
      trace,
      createdTokenIds,
      createdGithubIds,
    });

    await markSessionCheckFresh(pool, session.sessionId);
    const client = await openLiveSocket(
      Number(server.info.port),
      session.sessionToken,
      sockets,
    );
    const closePromise = waitForClose(client.ws, CLOSE_WAIT_MS);

    await expireAccessToken(pool, session.sessionId);
    trace.mode = { kind: "refuse" };

    const fileResponse = await callWithBearer(server, {
      method: "GET",
      url: `/api/repos/${REPO}/github/file?path=README.md`,
      token: session.sessionToken,
    });
    const closeOutcome = await closePromise;
    const meAfter = await callWithBearer(server, {
      method: "GET",
      url: "/api/auth/me",
      token: session.sessionToken,
    });
    const stored = await readSessionState(pool, session.sessionId);

    expect({
      fileStatus: fileResponse.statusCode,
      revoked: stored.revoked,
      storedTokenRows: stored.storedTokenRows,
      wsClosed: closeOutcome.closed,
      meStatusAfter: meAfter.statusCode,
      refreshCalls: trace.refreshCalls,
    }).toEqual({
      fileStatus: 401,
      revoked: true,
      storedTokenRows: 0,
      wsClosed: true,
      meStatusAfter: 401,
      refreshCalls: 1,
    });
  });

  it.each(["5xx", "timeout", "incomplete-2xx"] as const)(
    "ends the session, deletes stored tokens, closes open live sockets, and refuses later requests with 401 after a sent refresh gets %s",
    async (failureKind) => {
      const session = await signInOverHttp({
        server,
        pool,
        trace,
        createdTokenIds,
        createdGithubIds,
      });

      await markSessionCheckFresh(pool, session.sessionId);
      const client = await openLiveSocket(
        Number(server.info.port),
        session.sessionToken,
        sockets,
      );
      const closePromise = waitForClose(client.ws, CLOSE_WAIT_MS);

      await expireAccessToken(pool, session.sessionId);
      trace.mode = { kind: failureKind };

      const fileResponse = await callWithBearer(server, {
        method: "GET",
        url: `/api/repos/${REPO}/github/file?path=README.md`,
        token: session.sessionToken,
      });
      const closeOutcome = await closePromise;
      const meAfter = await callWithBearer(server, {
        method: "GET",
        url: "/api/auth/me",
        token: session.sessionToken,
      });
      const stored = await readSessionState(pool, session.sessionId);

      expect({
        fileStatus: fileResponse.statusCode,
        revoked: stored.revoked,
        storedTokenRows: stored.storedTokenRows,
        wsClosed: closeOutcome.closed,
        meStatusAfter: meAfter.statusCode,
        refreshCalls: trace.refreshCalls,
      }).toEqual({
        fileStatus: 503,
        revoked: true,
        storedTokenRows: 0,
        wsClosed: true,
        meStatusAfter: 401,
        refreshCalls: 1,
      });
    },
  );

  it("keeps the session and stored tokens when the refresh request never left lore-api and refreshes on the next request once GitHub is reachable", async () => {
    const session = await signInOverHttp({
      server,
      pool,
      trace,
      createdTokenIds,
      createdGithubIds,
    });

    await markSessionCheckFresh(pool, session.sessionId);
    const client = await openLiveSocket(
      Number(server.info.port),
      session.sessionToken,
      sockets,
    );

    await expireAccessToken(pool, session.sessionId);
    trace.mode = { kind: "never-left" };

    const refusedResponse = await callWithBearer(server, {
      method: "GET",
      url: `/api/repos/${REPO}/github/file?path=README.md`,
      token: session.sessionToken,
    });
    const wsStatusWhileUnreachable = await sendRepoProbe(client, "probe-1");
    const stateAfterUnreachable = await readSessionState(
      pool,
      session.sessionId,
    );

    trace.mode = {
      kind: "rotate",
      accessToken: "ghu_sc016_recovered",
      refreshToken: "ghr_sc016_recovered",
    };

    const recoveredResponse = await callWithBearer(server, {
      method: "GET",
      url: `/api/repos/${REPO}/github/file?path=README.md`,
      token: session.sessionToken,
    });
    const stateAfterRecovery = await readSessionState(pool, session.sessionId);

    expect({
      refusedStatus: refusedResponse.statusCode,
      revokedWhileUnreachable: stateAfterUnreachable.revoked,
      storedRowsWhileUnreachable: stateAfterUnreachable.storedTokenRows,
      wsStatusWhileUnreachable,
      recoveredStatus: recoveredResponse.statusCode,
      recoveredBody: recoveredResponse.result,
      fileAuthHeaders: trace.fileAuthHeaders,
      revokedAfterRecovery: stateAfterRecovery.revoked,
      recoveredPair: stateAfterRecovery.pair,
    }).toEqual({
      refusedStatus: 503,
      revokedWhileUnreachable: false,
      storedRowsWhileUnreachable: 1,
      wsStatusWhileUnreachable: 200,
      recoveredStatus: 200,
      recoveredBody: { content: "hello from github" },
      fileAuthHeaders: ["Bearer ghu_sc016_recovered"],
      revokedAfterRecovery: false,
      recoveredPair: {
        accessToken: "ghu_sc016_recovered",
        expiresIn: 28800,
        refreshToken: "ghr_sc016_recovered",
        refreshTokenExpiresIn: 15897600,
      },
    });
  });
});

function configureIntegrationEnv(): void {
  process.env.LORE_API_URL = API_URL;
  process.env.LORE_UI_URL = UI_URL;
  process.env.GITHUB_ORG = GITHUB_ORG;
  process.env.GITHUB_APP_CLIENT_ID = "sc016-client-id";
  process.env.GITHUB_APP_CLIENT_SECRET = "sc016-client-secret";
  process.env.GITHUB_APP_INSTALLATION_ID = INSTALLATION_ID;
  process.env.GITHUB_TOKEN = "sc016-app-token";
  process.env.LORE_USER_TOKEN_ENCRYPTION_KEY = ENCRYPTION_KEY;
  process.env.LORE_INGEST_TOKEN = ADMIN_TOKEN;
  delete process.env.GITHUB_APP_ID;
  delete process.env.GITHUB_APP_PRIVATE_KEY;
  delete process.env.GITHUB_HOST;
}

function createTestPool(): pg.Pool {
  return new pg.Pool({
    host: process.env.LORE_DB_HOST || "localhost",
    port: parseInt(process.env.LORE_DB_PORT || "5432"),
    database: process.env.LORE_DB_NAME || "lore_test",
    user: process.env.LORE_DB_USER || "lore",
    password: process.env.LORE_DB_PASSWORD || "test",
  });
}

async function cleanupDatabase(
  pool: pg.Pool | undefined,
  tokenIds: string[],
  githubIds: number[],
): Promise<void> {
  if (!pool) {
    return;
  }

  if (tokenIds.length > 0) {
    await pool.query("DELETE FROM pipeline.api_tokens WHERE id = ANY($1)", [
      tokenIds,
    ]);
  }

  if (githubIds.length > 0) {
    await pool.query(
      "DELETE FROM pipeline.person_generations WHERE github_id = ANY($1)",
      [githubIds],
    );
  }
  await pool.end();
}

async function signInOverHttp(input: {
  server: Server;
  pool: pg.Pool;
  trace: GithubTrace;
  createdTokenIds: string[];
  createdGithubIds: number[];
}): Promise<{ sessionId: string; sessionToken: string }> {
  input.trace.nextGithubId += 1;
  input.createdGithubIds.push(input.trace.nextGithubId);

  const loginResponse = await input.server.inject({
    method: "GET",
    url: `/api/auth/login?return=${encodeURIComponent(`${UI_URL}/inbox`)}`,
  });
  const oauthState =
    new URL(String(loginResponse.headers.location)).searchParams.get("state") ??
    "";
  const callbackResponse = await input.server.inject({
    method: "GET",
    url: `/api/auth/callback?code=gh-code&state=${encodeURIComponent(oauthState)}`,
  });
  const code =
    new URL(String(callbackResponse.headers.location)).searchParams.get(
      "code",
    ) ?? "";
  const redeemResponse = await input.server.inject({
    method: "POST",
    url: "/api/auth/redeem",
    payload: { code },
  });

  enforceTrue(
    redeemResponse.statusCode === 200,
    Error,
    `redeem failed: ${redeemResponse.statusCode} ${redeemResponse.payload}`,
  );

  const sessionToken = (redeemResponse.result as { token: string }).token;
  const { rows } = await input.pool.query<{ id: string }>(
    "SELECT id FROM pipeline.api_tokens WHERE token_hash = $1",
    [hashToken(sessionToken)],
  );
  const sessionId = rows[0].id;

  input.createdTokenIds.push(sessionId);

  return { sessionId, sessionToken };
}

async function markSessionCheckFresh(
  pool: pg.Pool,
  sessionId: string,
): Promise<void> {
  await pool.query(
    `UPDATE pipeline.api_tokens
       SET membership_checked_at = now(), repos_refreshed_at = now()
       WHERE id = $1`,
    [sessionId],
  );
}

async function markRepoListStale(
  pool: pg.Pool,
  sessionId: string,
): Promise<void> {
  await pool.query(
    `UPDATE pipeline.api_tokens
       SET repos_refreshed_at = now() - interval '10 minutes'
       WHERE id = $1`,
    [sessionId],
  );
}

async function expireAccessToken(
  pool: pg.Pool,
  sessionId: string,
): Promise<void> {
  await pool.query(
    `UPDATE pipeline.user_session_tokens
       SET access_token_expires_at = now() - interval '10 minutes'
       WHERE token_id = $1`,
    [sessionId],
  );
}

async function readSessionState(pool: pg.Pool, sessionId: string) {
  const tokenRows = await pool.query<{ revoked: boolean }>(
    `SELECT (revoked_at IS NOT NULL) AS revoked
       FROM pipeline.api_tokens WHERE id = $1`,
    [sessionId],
  );
  const storedRows = await pool.query<{
    encrypted_tokens: string;
    access_fresh: boolean;
    refresh_fresh: boolean;
  }>(
    `SELECT encrypted_tokens,
         (access_token_expires_at > now() + interval '1 hour') AS access_fresh,
         (refresh_token_expires_at > now() + interval '1 day') AS refresh_fresh
       FROM pipeline.user_session_tokens WHERE token_id = $1`,
    [sessionId],
  );

  return {
    revoked: tokenRows.rows[0]?.revoked ?? false,
    storedTokenRows: storedRows.rows.length,
    ...storedTokenSummary(storedRows.rows[0]),
  };
}

function storedTokenSummary(
  row:
    | {
        encrypted_tokens: string;
        access_fresh: boolean;
        refresh_fresh: boolean;
      }
    | undefined,
) {
  if (!row) {
    return { accessFresh: false, refreshFresh: false, pair: null };
  }

  return {
    accessFresh: row.access_fresh,
    refreshFresh: row.refresh_fresh,
    pair: decryptTokenPair(row.encrypted_tokens, ENCRYPTION_KEY),
  };
}

function callWithBearer(
  server: Server,
  options: { method: "GET" | "POST"; url: string; token: string },
) {
  return server.inject({
    method: options.method,
    url: options.url,
    headers: { authorization: `Bearer ${options.token}` },
  });
}

function installGithubFetch(trace: GithubTrace): void {
  globalThis.fetch = (async (input: string | URL | Request, init) => {
    const url = String(input);

    if (url === "https://github.com/login/oauth/access_token") {
      return handleTokenRequest(trace, init);
    }

    return handleGithubApiRequest(trace, url, init);
  }) as typeof fetch;
}

function handleTokenRequest(
  trace: GithubTrace,
  init: RequestInit | undefined,
): Response {
  const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, string>;

  if (body.grant_type !== "refresh_token") {
    return Response.json({
      access_token: INITIAL_ACCESS_TOKEN,
      expires_in: 28800,
      refresh_token: INITIAL_REFRESH_TOKEN,
      refresh_token_expires_in: 15897600,
      token_type: "bearer",
    });
  }

  trace.refreshCalls += 1;

  return respondToRefresh(trace.mode);
}

function respondToRefresh(mode: RefreshMode): Response {
  if (mode.kind === "rotate") {
    return Response.json({
      access_token: mode.accessToken,
      expires_in: 28800,
      refresh_token: mode.refreshToken,
      refresh_token_expires_in: 15897600,
      token_type: "bearer",
    });
  }

  if (mode.kind === "refuse") {
    return Response.json(
      {
        error: "bad_refresh_token",
        error_description: "The refresh token passed is incorrect or expired.",
      },
      { status: 400 },
    );
  }

  if (mode.kind === "5xx") {
    return new Response("upstream error", { status: 502 });
  }

  if (mode.kind === "timeout") {
    throw new DOMException(
      "The operation was aborted due to timeout",
      "TimeoutError",
    );
  }

  if (mode.kind === "incomplete-2xx") {
    return Response.json({ access_token: "ghu_missing_pair" });
  }

  const cause = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:443"), {
    code: "ECONNREFUSED",
  });

  throw Object.assign(new TypeError("fetch failed"), { cause });
}

function handleGithubApiRequest(
  trace: GithubTrace,
  url: string,
  init: RequestInit | undefined,
): Response {
  const auth = new Headers(init?.headers).get("authorization") ?? "";

  if (url === "https://api.github.com/user") {
    return Response.json({
      id: trace.nextGithubId,
      login: `ana-${trace.nextGithubId}`,
      name: "Ana",
      avatar_url: "",
    });
  }

  if (isMembershipUrl(url)) {
    return Response.json({ state: "active", role: "member" });
  }

  return handleRepoApiRequest(trace, url, auth);
}

function isMembershipUrl(url: string): boolean {
  return (
    url === `https://api.github.com/user/memberships/orgs/${GITHUB_ORG}` ||
    url.startsWith(`https://api.github.com/orgs/${GITHUB_ORG}/memberships/`)
  );
}

function handleRepoApiRequest(
  trace: GithubTrace,
  url: string,
  auth: string,
): Response {
  if (
    url.startsWith(
      `https://api.github.com/user/installations/${INSTALLATION_ID}/repositories`,
    )
  ) {
    trace.repoListAuthHeaders.push(auth);

    return Response.json({ repositories: [{ full_name: REPO }] });
  }

  if (url === `https://api.github.com/repos/${REPO}/contents/README.md`) {
    trace.fileAuthHeaders.push(auth);

    return Response.json({
      type: "file",
      content: Buffer.from("hello from github").toString("base64"),
    });
  }

  return new Response(`unexpected url: ${url}`, { status: 404 });
}

async function openLiveSocket(
  port: number,
  sessionToken: string,
  sockets: WebSocket[],
) {
  const client = queuedClient(port, "/api/ws", cookieOf(sessionToken));

  sockets.push(client.ws);
  await client.open();

  return client;
}

async function sendRepoProbe(
  client: ReturnType<typeof queuedClient>,
  id: string,
): Promise<number> {
  if (client.ws.readyState !== WebSocket.OPEN) {
    return -1;
  }

  client.send({ type: "request", id, method: "GET", path: "/api/repos" });

  for (;;) {
    const message = await client.next();

    if (message.type === "response" && message.id === id) {
      return message.status;
    }
  }
}

function waitForClose(
  ws: WebSocket,
  timeoutMs: number,
): Promise<{ closed: boolean; code: number | null }> {
  if (ws.readyState === WebSocket.CLOSED) {
    return Promise.resolve({ closed: true, code: null });
  }

  return new Promise((resolve) => {
    const timer = setTimeout(
      () => resolve({ closed: false, code: null }),
      timeoutMs,
    );

    ws.once("close", (code) => {
      clearTimeout(timer);
      resolve({ closed: true, code });
    });
  });
}
