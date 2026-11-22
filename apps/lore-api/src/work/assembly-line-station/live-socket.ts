// The browser's one live socket (ADR-048): an upgrade at /api/ws on lore-api's own listener, one connection per tab, channels opened by the client and served by the run, run-list, plan-run and plan handlers. Ping/pong keeps it honest through the ingress; a socket that stops answering is terminated and its channels closed.

import type { IncomingMessage, Server as HttpServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { ChannelRegistry, type ChannelHandle } from "./channel-registry.js";
import type { CollabServer } from "./plan-channel.js";
import {
  base64ToBytes,
  encodeServerMessage,
  parseClientMessage,
  type LiveClientMessage,
  type LiveServerMessage,
  type OpenMessage,
  type RequestMessage,
} from "./protocol.js";
import type { ChannelOutlet, RunChannelDeps } from "./run-channel.js";
import type { RunsChannelDeps } from "./runs-channel.js";
import type { PlanRunChannelDeps } from "./plan-run-channel.js";
import { answerRequest, type SocketInject } from "./socket-request.js";
import type { SessionAccess, SocketPerson } from "./socket-session.js";
import { OPENERS, type Opener } from "./open-channel.js";
import { FreshGate } from "./fresh-gate.js";
import { SessionSockets } from "./session-sockets.js";
import { webRequest } from "./web-request.js";
import { UpgradeGate, type LiveSocketLimits } from "./upgrade-gate.js";

export type { LiveSocketLimits } from "./upgrade-gate.js";

const PING_MS = 25_000;

/** Largest client frame: a plan update rides one `send`; anything bigger is not a browser tab. */
const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;

const OPEN = 1;

interface SessionLink {
  token: string | undefined;
  bySession: SessionSockets;
}

type ChannelMessage = Exclude<LiveClientMessage, OpenMessage | RequestMessage>;

let connectionSeq = 0;

export interface LiveSocketDeps {
  run: RunChannelDeps;
  runs: RunsChannelDeps;
  planRun: PlanRunChannelDeps;
  collab: CollabServer;
  /** The person a session token belongs to, or null for a token that is no person's (a service token) or no longer valid. */
  person(token: string): Promise<SocketPerson | null>;
  /** Runs a lore-api route in-process, for `request` messages. */
  inject: SocketInject;
  limits?: LiveSocketLimits;
  pingMs?: number;
  maxSockets?: number;
  maxSocketsPerAddress?: number;
  log?: (message: string) => void;
}

export interface LiveSocketMount {
  /** Terminates every connection and stops accepting upgrades; for the server's stop. */
  close(): void;
  readonly connectionCount: number;
  /** Closes every live socket opened with the session row, for a session that ended (FR-279). */
  closeSession(sessionId: string): void;
}

export function mountLiveSocket(
  listener: HttpServer,
  deps: LiveSocketDeps,
): LiveSocketMount {
  const sockets = newServer();
  const bySession = new SessionSockets();
  const onUpgrade = gateFor(sockets, deps, bySession);

  listener.on("upgrade", onUpgrade);

  return {
    close: () => {
      listener.off("upgrade", onUpgrade);
      terminateAll(sockets);
    },
    get connectionCount() {
      return sockets.clients.size;
    },
    closeSession: (sessionId) => bySession.close(sessionId),
  };
}

function newServer(): WebSocketServer {
  return new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
}

function gateFor(
  sockets: WebSocketServer,
  deps: LiveSocketDeps,
  bySession: SessionSockets,
): UpgradeGate<LiveSocketDeps>["onUpgrade"] {
  return new UpgradeGate(sockets, deps, (ws, request, gateDeps, token) =>
    serve(ws, request, gateDeps, { token, bySession }),
  ).onUpgrade;
}

function terminateAll(sockets: WebSocketServer): void {
  for (const ws of sockets.clients) {
    ws.terminate();
  }
  sockets.close();
}

/** One tab's connection: parses, dispatches to the channel handlers, and tears every channel down when the socket goes. */
class LiveConnection {
  private readonly registry = new ChannelRegistry();
  private alive = true;
  private recorded = false;
  private readonly gate: FreshGate;
  private readonly id = `conn:${++connectionSeq}`;

  constructor(
    private readonly ws: WebSocket,
    private readonly request: IncomingMessage,
    private readonly deps: LiveSocketDeps,
    private readonly link: SessionLink,
  ) {
    this.gate = new FreshGate(
      ws,
      link.token,
      (token) => deps.person(token),
      (person) => {
        for (const id of this.registry.closeUnreadable(person)) {
          this.send({ type: "closed", channel: id, reason: "unauthorized" });
        }
      },
    );
  }

  start(): void {
    this.recordSession();
    const ping = setInterval(() => this.ping(), this.deps.pingMs ?? PING_MS);

    this.ws.on("pong", () => (this.alive = true));
    this.ws.on("message", (raw) => this.onMessage(raw.toString()));
    this.ws.on("error", (err) => this.log(`socket error: ${err.message}`));
    this.ws.on("close", () => {
      clearInterval(ping);
      this.registry.closeAll();
    });
  }

  /** FR-300: the socket is held under the id of the session row that opened it. */
  private recordSession(): void {
    const row = this.session()
      .person()
      .then((person) => person?.sessionId)
      .catch(() => undefined);

    this.link.bySession.lookup(this.ws, row);
  }

  /** FR-284: channels on repositories the person can no longer read close; the socket stays. */
  private recordPerson(person: SocketPerson | null): void {
    if (!this.recorded && person?.sessionId && this.ws.readyState === OPEN) {
      this.recorded = true;
      this.link.bySession.add(person.sessionId, this.ws);
    }
  }

  private ping(): void {
    if (!this.alive) {
      this.ws.terminate();

      return;
    }
    this.alive = false;
    this.ws.ping();
  }

  private send(message: LiveServerMessage): void {
    this.gate.run(() => {
      if (this.ws.readyState === OPEN) {
        this.ws.send(encodeServerMessage(message));
      }
    });
  }

  private onMessage(text: string): void {
    const message = parseClientMessage(text);

    if (message === null) {
      this.send({ type: "error", code: "bad_message" });

      return;
    }
    this.gate.run(() => this.dispatch(message));
  }

  private dispatch(message: LiveClientMessage): void {
    if (message.type === "open") {
      return this.open(message);
    }

    if (message.type === "request") {
      return void this.answer(message);
    }

    return this.dispatchToChannel(message);
  }

  /** A route that throws is a 500 for that request; the socket and its channels stay up. */
  private async answer(message: RequestMessage): Promise<void> {
    try {
      this.send(
        await answerRequest(message, this.link.token, this.deps.inject),
      );
    } catch (err) {
      this.log(`request failed: ${(err as Error).message}`);
      this.send({
        type: "response",
        id: message.id,
        status: 500,
        body: { error: "internal error" },
      });
    }
  }

  private dispatchToChannel(message: ChannelMessage): void {
    switch (message.type) {
      case "send":
        return this.handleOf(message.channel)?.receive(
          base64ToBytes(message.data),
        );
      case "watch":
        return this.handleOf(message.channel)?.watch?.(message.runs);
      default:
        return this.close(message.channel);
    }
  }

  /** The channel's handle, or undefined after telling the client it names no open channel. */
  private handleOf(channel: string): ChannelHandle | undefined {
    const handle = this.registry.get(channel);

    if (!handle) {
      this.send({ type: "error", channel, code: "unknown_channel" });
    }

    return handle;
  }

  private close(channel: string): void {
    const handle = this.handleOf(channel);

    if (!handle) {
      return;
    }
    this.registry.forget(channel);
    handle.close();
    this.send({ type: "closed", channel, reason: "client" });
  }

  /** The id is taken the moment the open arrives, so a second open for it while the first still verifies its token is refused rather than raced. */
  private open(message: OpenMessage): void {
    const { channel } = message;

    if (this.deps.limits?.allowOpen(this.id) === false) {
      this.send({ type: "error", channel, code: "rate_limited" });

      return;
    }
    const refusal = this.registry.refusal(channel);

    if (refusal) {
      this.send({ type: "error", channel, code: refusal });

      return;
    }
    const placeholder = { cancelled: false };

    this.registry.add(channel, {
      receive: () => {},
      close: () => (placeholder.cancelled = true),
    });
    void this.settle(message, placeholder);
  }

  private async settle(
    message: OpenMessage,
    placeholder: { cancelled: boolean },
  ): Promise<void> {
    const { channel } = message;
    const handle = await this.openHandle(message);

    if (handle === null) {
      this.registry.forget(channel);

      return;
    }

    if (placeholder.cancelled) {
      handle.close();

      return;
    }
    this.registry.add(channel, handle);
  }

  /** The handler's own refusals arrive as `closed` envelopes; a handler that throws (a database away) is reported as a server close rather than dropping the whole socket. */
  private async openHandle(
    message: OpenMessage,
  ): Promise<ChannelHandle | null> {
    const outlet = this.outletFor(message.channel);

    try {
      return await this.handlerFor(message, outlet);
    } catch (err) {
      this.log(`open ${message.kind} failed: ${(err as Error).message}`);
      outlet.send({
        type: "closed",
        channel: message.channel,
        reason: "server",
      });

      return null;
    }
  }

  private handlerFor(
    message: OpenMessage,
    outlet: ChannelOutlet,
  ): Promise<ChannelHandle | null> {
    const open = OPENERS[message.kind] as Opener<OpenMessage>;

    return open(message, outlet, {
      deps: this.deps,
      request: () => webRequest(this.request),
      session: this.session(),
    });
  }

  private session(): SessionAccess {
    const { token } = this.link;

    return {
      person: async () => {
        const person = token ? await this.deps.person(token) : null;

        this.recordPerson(person);

        return person;
      },
    };
  }

  private outletFor(channel: string): ChannelOutlet {
    return {
      send: (message) => this.send(message),
      bufferedBytes: () => this.ws.bufferedAmount,
      ended: () => this.registry.forget(channel),
    };
  }

  private log(message: string): void {
    (this.deps.log ?? console.error)(`[live-socket] ${message}`);
  }
}

function serve(
  ws: WebSocket,
  request: IncomingMessage,
  deps: LiveSocketDeps,
  link: SessionLink,
): void {
  new LiveConnection(ws, request, deps, link).start();
}
