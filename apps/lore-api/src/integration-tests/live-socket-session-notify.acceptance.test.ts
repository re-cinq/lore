import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Server } from "@hapi/hapi";
import { AuthMessageType, writeAuthentication } from "@hocuspocus/common";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import pg from "pg";
import { WebSocket } from "ws";
import {
  cookieOf,
  queuedClient,
} from "../work/assembly-line-station/live-socket.fixtures.js";
import { mintApiToken } from "../work/tokens/mint-token.js";
import { restoreEnv } from "./restore-env.js";

const REPO = "acme/session-notify-replicas";
const ADMIN_TOKEN = "notify-replicas-admin-token";
const HOCUSPOCUS_AUTH_MESSAGE = 2;
const CLOSE_WAIT_MS = 3000;

interface CloseOutcome {
  closed: boolean;
  code: number | null;
}

describe("Session-ended PostgreSQL notification across lore-api replicas (FR-302, FR-303)", () => {
  restoreEnv();

  let pool: pg.Pool;
  let replicaA: Server;
  let replicaB: Server;
  let revokeAccessOnReplicaA: (
    db: pg.Pool,
    githubId: number,
  ) => Promise<number>;
  const createdTokenIds: string[] = [];
  const sockets: WebSocket[] = [];

  beforeAll(async () => {
    process.env.LORE_INGEST_TOKEN = ADMIN_TOKEN;
    process.env.LORE_UI_URL = "http://localhost:3000";
    process.env.LORE_API_URL = "http://localhost:3001";
    delete process.env.GITHUB_ORG;
    pool = new pg.Pool({
      host: process.env.LORE_DB_HOST || "localhost",
      port: parseInt(process.env.LORE_DB_PORT || "5432"),
      database: process.env.LORE_DB_NAME || "lore_test",
      user: process.env.LORE_DB_USER || "lore",
      password: process.env.LORE_DB_PASSWORD || "test",
    });
    vi.resetModules();
    const modA = await import("../app/build-server.js");
    const accessModA = await import("../work/auth/person-access.js");

    revokeAccessOnReplicaA = accessModA.revokePersonAccess;
    replicaA = modA.buildServer(() => pool, 0);
    vi.resetModules();
    const modB = await import("../app/build-server.js");

    replicaB = modB.buildServer(() => pool, 0);
    await replicaA.start();
    await replicaB.start();
  }, 30_000);

  afterAll(async () => {
    for (const ws of sockets.splice(0)) {
      ws.terminate();
    }
    await stopServers(replicaA, replicaB);
    await cleanupDatabase(pool, createdTokenIds);
  }, 30_000);

  it("notifies and closes live sockets and open plan collaboration connections on another replica when a session ends by sign-out, row revocation, or access revocation", async () => {
    const planId = await createPlan(replicaA);
    const sessionOne = await createUserSession(pool, createdTokenIds, {
      name: "notify-s1",
      login: "ana",
      githubId: 990302,
    });
    const sessionTwo = await createUserSession(pool, createdTokenIds, {
      name: "notify-s2",
      login: "ana",
      githubId: 990302,
    });
    const sessionThree = await createUserSession(pool, createdTokenIds, {
      name: "notify-s3",
      login: "ben",
      githubId: 990303,
    });
    const collabOne = await mintCollabTokenFor(
      replicaA,
      planId,
      sessionOne.token,
    );
    const portB = Number(replicaB.info.port);
    const wsOne = await openLiveSocket(portB, sessionOne.token, sockets);
    const collabOneWs = await openDirectCollab(
      portB,
      collabOne.documentName,
      collabOne.token,
      sockets,
    );
    const wsTwo = await openLiveSocket(portB, sessionTwo.token, sockets);
    const wsThree = await openLiveSocket(portB, sessionThree.token, sockets);
    const logoutStep = await verifyLogoutClosesReplicaB({
      replicaA,
      sessionOneToken: sessionOne.token,
      wsOne,
      collabOneWs,
      wsTwo,
    });
    const revokeStep = await verifyRevokeClosesReplicaB({
      replicaA,
      adminToken: sessionThree.token,
      sessionTwoId: sessionTwo.id,
      wsTwo,
      wsThree,
    });
    const removalStep = await verifyAccessRevokeClosesReplicaB(
      revokeAccessOnReplicaA,
      pool,
      990303,
      wsThree,
    );

    expect({
      collabOneAuthVerdict: collabOneWs.authVerdict,
      wsOneClosedOnLogout: logoutStep.wsClosed,
      collabOneClosedOnLogout: logoutStep.collabClosed,
      wsTwoAliveAfterLogout: logoutStep.wsTwoStatus,
      wsTwoClosedOnRevoke: revokeStep.wsClosed,
      wsThreeAliveAfterRevoke: revokeStep.wsThreeStatus,
      wsThreeClosedOnRemoval: removalStep.closed,
    }).toEqual({
      collabOneAuthVerdict: AuthMessageType.Authenticated,
      wsOneClosedOnLogout: true,
      collabOneClosedOnLogout: true,
      wsTwoAliveAfterLogout: 200,
      wsTwoClosedOnRevoke: true,
      wsThreeAliveAfterRevoke: 200,
      wsThreeClosedOnRemoval: true,
    });
  });
});

async function stopServers(replicaA: Server, replicaB: Server): Promise<void> {
  if (replicaA) {
    await replicaA.stop();
  }

  if (replicaB) {
    await replicaB.stop();
  }
}

async function cleanupDatabase(
  pool: pg.Pool | undefined,
  createdTokenIds: string[],
): Promise<void> {
  if (!pool) {
    return;
  }

  await pool.query("DELETE FROM lore.plans WHERE repo = $1", [REPO]);

  if (createdTokenIds.length > 0) {
    await pool.query("DELETE FROM pipeline.api_tokens WHERE id = ANY($1)", [
      createdTokenIds,
    ]);
  }
  await pool.query(
    "DELETE FROM pipeline.person_generations WHERE github_id = ANY($1)",
    [[990302, 990303]],
  );
  await pool.end();
}

async function verifyLogoutClosesReplicaB(input: {
  replicaA: Server;
  sessionOneToken: string;
  wsOne: ReturnType<typeof queuedClient>;
  collabOneWs: { ws: WebSocket };
  wsTwo: ReturnType<typeof queuedClient>;
}) {
  const wsOneClose = waitForClose(input.wsOne.ws, CLOSE_WAIT_MS);
  const collabOneClose = waitForClose(input.collabOneWs.ws, CLOSE_WAIT_MS);

  await callJson(input.replicaA, {
    method: "POST",
    url: "/api/auth/logout",
    token: input.sessionOneToken,
  });
  const [wsOneOutcome, collabOneOutcome] = await Promise.all([
    wsOneClose,
    collabOneClose,
  ]);
  const wsTwoStatus = await sendRepoProbe(input.wsTwo, "p2");

  return {
    wsClosed: wsOneOutcome.closed,
    collabClosed: collabOneOutcome.closed,
    wsTwoStatus,
  };
}

async function verifyRevokeClosesReplicaB(input: {
  replicaA: Server;
  adminToken: string;
  sessionTwoId: string;
  wsTwo: ReturnType<typeof queuedClient>;
  wsThree: ReturnType<typeof queuedClient>;
}) {
  const wsTwoClose = waitForClose(input.wsTwo.ws, CLOSE_WAIT_MS);

  await callJson(input.replicaA, {
    method: "POST",
    url: "/api/tokens",
    token: input.adminToken,
    payload: { action: "revoke", token_id: input.sessionTwoId },
  });
  const wsTwoOutcome = await wsTwoClose;
  const wsThreeStatus = await sendRepoProbe(input.wsThree, "p3");

  return { wsClosed: wsTwoOutcome.closed, wsThreeStatus };
}

async function verifyAccessRevokeClosesReplicaB(
  revokeAccess: (db: pg.Pool, githubId: number) => Promise<number>,
  pool: pg.Pool,
  githubId: number,
  wsThree: ReturnType<typeof queuedClient>,
) {
  const wsThreeClose = waitForClose(wsThree.ws, CLOSE_WAIT_MS);

  await revokeAccess(pool, githubId);

  return wsThreeClose;
}

async function createPlan(server: Server): Promise<string> {
  const res = await callJson(server, {
    method: "POST",
    url: "/api/plans",
    token: ADMIN_TOKEN,
    payload: {
      repo: REPO,
      title: "Replica notify plan",
      type: "feature",
      createdBy: "ana",
    },
  });

  enforceTrue(
    res.statusCode === 200 || res.statusCode === 201,
    Error,
    `createPlan failed: ${res.statusCode} ${res.payload}`,
  );

  return (res.result as { meta: { id: string } }).meta.id;
}

async function createUserSession(
  pool: pg.Pool,
  createdTokenIds: string[],
  person: { name: string; login: string; githubId: number },
): Promise<{ id: string; token: string }> {
  const minted = await mintApiToken(pool, {
    name: person.name,
    scopes: ["read", "write", "admin"],
    createdBy: person.login,
    expiresAt: null,
    kind: "user",
    user: {
      login: person.login,
      displayName: person.login.toUpperCase(),
      avatarUrl: "",
      repos: [REPO],
      githubId: person.githubId,
    },
  });

  createdTokenIds.push(minted.row.id);
  await pool.query(
    `UPDATE pipeline.api_tokens
       SET membership_checked_at = now(), repos_refreshed_at = now()
       WHERE id = $1`,
    [minted.row.id],
  );

  return { id: minted.row.id, token: minted.token };
}

async function mintCollabTokenFor(
  server: Server,
  planId: string,
  sessionToken: string,
): Promise<{ token: string; documentName: string }> {
  const res = await callJson(server, {
    method: "POST",
    url: `/api/repos/${REPO}/plans/${planId}/collab-token`,
    token: sessionToken,
    payload: { user: { id: "ana", name: "ANA" }, role: "write" },
  });

  enforceTrue(
    res.statusCode === 200,
    Error,
    `mintCollabToken failed: ${res.statusCode} ${res.payload}`,
  );

  return res.result as { token: string; documentName: string };
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

async function openDirectCollab(
  port: number,
  documentName: string,
  collabToken: string,
  sockets: WebSocket[],
): Promise<{ ws: WebSocket; authVerdict: number }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/plans/collab`);

  sockets.push(ws);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  const replyPromise = new Promise<Uint8Array | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), 1500);

    ws.once("message", (raw) => {
      clearTimeout(timer);
      resolve(toUint8(raw));
    });
  });

  ws.send(hocuspocusAuthBytes(documentName, collabToken));
  const reply = await replyPromise;

  return { ws, authVerdict: reply ? readAuthReplyVerdict(reply) : -1 };
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

async function callJson(
  server: Server,
  options: {
    method: "GET" | "POST";
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

function hocuspocusAuthBytes(documentName: string, token: string): Uint8Array {
  const encoder = encoding.createEncoder();

  encoding.writeVarString(encoder, documentName);
  encoding.writeVarUint(encoder, HOCUSPOCUS_AUTH_MESSAGE);
  writeAuthentication(encoder, token);

  return encoding.toUint8Array(encoder);
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

function waitForClose(ws: WebSocket, timeoutMs: number): Promise<CloseOutcome> {
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
