import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "@hapi/hapi";
import pg from "pg";
import { WebSocket } from "ws";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { AuthMessageType, writeAuthentication } from "@hocuspocus/common";
import { buildServer } from "../app/build-server.js";
import { restoreEnv } from "./restore-env.js";
import {
  base64ToBytes,
  bytesToBase64,
  type LiveServerMessage,
} from "../work/assembly-line-station/protocol.js";
import { setPipelinePool } from "@re-cinq/lore-server-core/features/pipeline/pipeline.js";

const TOKEN = "test-live-socket-token";
const REPO = "acme/live-socket";
const ANA = { id: "ana", name: "Ana" };

const HOCUSPOCUS_AUTH_MESSAGE = 2;

function queuedClient(port: number) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/ws`);
  const queue: LiveServerMessage[] = [];
  const waiters: ((m: LiveServerMessage) => void)[] = [];

  ws.on("message", (raw) => {
    const message = JSON.parse(raw.toString()) as LiveServerMessage;
    const waiter = waiters.shift();

    if (waiter) {
      waiter(message);

      return;
    }
    queue.push(message);
  });

  return {
    ws,
    open: () =>
      new Promise<void>((resolve) => ws.once("open", () => resolve())),
    send: (message: object) => ws.send(JSON.stringify(message)),
    next: () =>
      new Promise<LiveServerMessage>((resolve) => {
        const queued = queue.shift();

        if (queued) {
          resolve(queued);

          return;
        }
        waiters.push(resolve);
      }),
  };
}

function hocuspocusAuthMessage(documentName: string, token: string): string {
  const encoder = encoding.createEncoder();

  encoding.writeVarString(encoder, documentName);
  encoding.writeVarUint(encoder, HOCUSPOCUS_AUTH_MESSAGE);
  writeAuthentication(encoder, token);

  return bytesToBase64(encoding.toUint8Array(encoder));
}

function readAuthReply(encoded: string): { document: string; verdict: number } {
  const decoder = decoding.createDecoder(base64ToBytes(encoded));
  const document = decoding.readVarString(decoder);

  decoding.readVarUint(decoder);

  return { document, verdict: decoding.readVarUint(decoder) };
}

const authVerdict = (message: LiveServerMessage): unknown =>
  message.type === "data" ? readAuthReply(message.data) : message;

describe("the live socket on lore-api", () => {
  let pool: pg.Pool;
  let server: Server;
  let port: number;
  let runId: string;
  let planId: string;
  const prevToken = process.env.LORE_INGEST_TOKEN;
  const sockets: WebSocket[] = [];

  const call = async (method: string, url: string, payload?: object) => {
    const res = await server.inject({
      method,
      url,
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: payload ? JSON.stringify(payload) : undefined,
    });

    return { status: res.statusCode, body: JSON.parse(res.payload) as never };
  };

  const connect = async () => {
    const c = queuedClient(port);

    sockets.push(c.ws);
    await c.open();

    return c;
  };

  const runToken = async (): Promise<string> =>
    (
      (
        await call("POST", `/api/assembly-runs/${runId}/stream-token`, {
          user: ANA,
        })
      ).body as { token: string }
    ).token;

  const nextOn = async (
    c: ReturnType<typeof queuedClient>,
    channel: string,
  ) => {
    for (;;) {
      const m = await c.next();

      if ("channel" in m && m.channel === channel) {
        return m;
      }
    }
  };

  const untilCatchup = async (c: ReturnType<typeof queuedClient>) => {
    const types: string[] = [];

    for (;;) {
      const m = await c.next();

      types.push(m.type === "frame" ? m.frame.type : m.type);

      if (m.type === "frame" && m.frame.type === "catchup_complete") {
        return types;
      }
    }
  };

  beforeAll(async () => {
    process.env.LORE_INGEST_TOKEN = TOKEN;
    pool = new pg.Pool({
      host: process.env.LORE_DB_HOST || "localhost",
      port: parseInt(process.env.LORE_DB_PORT || "5432"),
      database: process.env.LORE_DB_NAME || "lore_test",
      user: process.env.LORE_DB_USER || "lore",
      password: process.env.LORE_DB_PASSWORD || "test",
    });
    setPipelinePool(pool);
    const run = await pool.query<{ id: string }>(
      `INSERT INTO pipeline.assembly_runs (blueprint_name, repo, args, status)
       VALUES ('implementation', $1, '{}'::jsonb, 'running') RETURNING id`,
      [REPO],
    );

    runId = run.rows[0].id;
    server = buildServer(() => pool);
    await server.start();
    port = Number(server.info.port);
    const plan = await call("POST", "/api/plans", {
      repo: REPO,
      title: "Faster checkout",
      type: "feature",
      createdBy: "ana",
    });

    planId = (plan.body as { meta: { id: string } }).meta.id;
  });

  afterAll(async () => {
    for (const ws of sockets) {
      ws.terminate();
    }
    await server.stop();
    await pool.query(
      "DELETE FROM pipeline.agent_run_events WHERE assembly_line_id = $1",
      [runId],
    );
    await pool.query("DELETE FROM pipeline.assembly_runs WHERE id = $1", [
      runId,
    ]);
    await pool.query("DELETE FROM lore.plans WHERE repo = $1", [REPO]);
    await pool.query("DELETE FROM lore.live_tokens WHERE user_id = $1", [
      ANA.id,
    ]);
    await pool.end();
    restoreEnv("LORE_INGEST_TOKEN", prevToken);
  });

  it("answers 404 to a stream token for a run that does not exist", async () => {
    const minted = await call(
      "POST",
      "/api/assembly-runs/00000000-0000-0000-0000-000000000000/stream-token",
      { user: ANA },
    );

    expect(minted.status).toBe(404);
  });

  it("opens a run channel with a minted token, catches up, then forwards a transcript row the database notifies", async () => {
    const c = await connect();

    c.send({
      type: "open",
      channel: "r",
      kind: "run",
      subject: runId,
      token: await runToken(),
    });

    expect(await c.next()).toEqual({ type: "opened", channel: "r" });
    expect(await untilCatchup(c)).toEqual(["run_status", "catchup_complete"]);
    await pool.query(
      `INSERT INTO pipeline.agent_run_events (task_id, assembly_line_id, event_type, summary)
       VALUES ('task-live', $1, 'tool_call', 'Edit src/foo.ts')`,
      [runId],
    );

    expect(await c.next()).toMatchObject({
      type: "frame",
      channel: "r",
      frame: { type: "agent_event", event: { summary: "Edit src/foo.ts" } },
    });
  });

  it("closes a run channel as unauthorized for a token it never minted", async () => {
    const c = await connect();

    c.send({
      type: "open",
      channel: "r",
      kind: "run",
      subject: runId,
      token: "forged",
    });

    expect(await c.next()).toEqual({
      type: "closed",
      channel: "r",
      reason: "unauthorized",
    });
  });

  it("tunnels the plan collaboration handshake: a minted collab token is authenticated, a forged one is refused, and the client can close the tunnel", async () => {
    const minted = await call(
      "POST",
      `/api/repos/${REPO}/plans/${planId}/collab-token`,
      {
        user: ANA,
        role: "write",
      },
    );
    const { token, documentName } = minted.body as {
      token: string;
      documentName: string;
    };
    const c = await connect();
    const exchange: [object, string][] = [
      [
        { type: "open", channel: "p", kind: "plan", subject: documentName },
        "p",
      ],
      [
        {
          type: "send",
          channel: "p",
          data: hocuspocusAuthMessage(documentName, token),
        },
        "p",
      ],
      [
        { type: "open", channel: "q", kind: "plan", subject: documentName },
        "q",
      ],
      [
        {
          type: "send",
          channel: "q",
          data: hocuspocusAuthMessage(documentName, "forged"),
        },
        "q",
      ],
      [{ type: "close", channel: "q" }, "q"],
    ];
    const replies: LiveServerMessage[] = [];

    for (const [message, channel] of exchange) {
      c.send(message);
      replies.push(await nextOn(c, channel));
    }

    expect(replies.map(authVerdict)).toEqual([
      { type: "opened", channel: "p" },
      { document: documentName, verdict: AuthMessageType.Authenticated },
      { type: "opened", channel: "q" },
      { document: documentName, verdict: AuthMessageType.PermissionDenied },
      { type: "closed", channel: "q", reason: "client" },
    ]);
  });
});
