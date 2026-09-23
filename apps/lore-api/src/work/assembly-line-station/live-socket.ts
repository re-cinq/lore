// The browser's one live socket (ADR-048): an upgrade at /api/ws on lore-api's own listener, one connection per tab, channels opened by the client and served by the run and plan handlers. Ping/pong keeps it honest through the ingress; a socket that stops answering is terminated and its channels closed.

import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { ChannelRegistry, type ChannelHandle } from "./channel-registry.js";
import { openPlanChannel, type CollabServer } from "./plan-channel.js";
import {
  base64ToBytes,
  encodeServerMessage,
  LIVE_SOCKET_PATH,
  parseClientMessage,
  type LiveClientMessage,
  type LiveServerMessage,
  type OpenMessage,
} from "./protocol.js";
import {
  openRunChannel,
  type ChannelOutlet,
  type RunChannelDeps,
} from "./run-channel.js";
import { urlOf, webRequest } from "./web-request.js";

const PING_MS = 25_000;

/** Largest client frame: a plan update rides one `send`; anything bigger is not a browser tab. */
const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;

const OPEN = 1;

export interface LiveSocketDeps {
  run: RunChannelDeps;
  collab: CollabServer;
  pingMs?: number;
  log?: (message: string) => void;
}

export interface LiveSocketMount {
  /** Terminates every connection and stops accepting upgrades; for the server's stop. */
  close(): void;
  readonly connectionCount: number;
}

export function mountLiveSocket(
  listener: HttpServer,
  deps: LiveSocketDeps,
): LiveSocketMount {
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_PAYLOAD_BYTES,
  });
  const onUpgrade = upgradeHandler(sockets, deps);

  listener.on("upgrade", onUpgrade);

  return {
    close: () => {
      listener.off("upgrade", onUpgrade);
      terminateAll(sockets);
    },
    get connectionCount() {
      return sockets.clients.size;
    },
  };
}

/** Another mount (the plans library's) shares the listener; a foreign path is its business and is left untouched. */
function upgradeHandler(sockets: WebSocketServer, deps: LiveSocketDeps) {
  return (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    if (urlOf(request).pathname !== LIVE_SOCKET_PATH) {
      return;
    }
    sockets.handleUpgrade(request, socket, head, (ws) =>
      serve(ws, request, deps),
    );
  };
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

  constructor(
    private readonly ws: WebSocket,
    private readonly request: IncomingMessage,
    private readonly deps: LiveSocketDeps,
  ) {}

  start(): void {
    const ping = setInterval(() => this.ping(), this.deps.pingMs ?? PING_MS);

    this.ws.on("pong", () => (this.alive = true));
    this.ws.on("message", (raw) => this.onMessage(raw.toString()));
    this.ws.on("error", (err) => this.log(`socket error: ${err.message}`));
    this.ws.on("close", () => {
      clearInterval(ping);
      this.registry.closeAll();
    });
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
    if (this.ws.readyState === OPEN) {
      this.ws.send(encodeServerMessage(message));
    }
  }

  private onMessage(text: string): void {
    const message = parseClientMessage(text);

    if (message === null) {
      this.send({ type: "error", code: "bad_message" });

      return;
    }
    this.dispatch(message);
  }

  private dispatch(message: LiveClientMessage): void {
    switch (message.type) {
      case "open":
        return this.open(message);
      case "send":
        return this.forward(message.channel, message.data);
      default:
        return this.close(message.channel);
    }
  }

  private forward(channel: string, encodedBytes: string): void {
    const handle = this.registry.get(channel);

    if (!handle) {
      this.send({ type: "error", channel, code: "unknown_channel" });

      return;
    }
    handle.receive(base64ToBytes(encodedBytes));
  }

  private close(channel: string): void {
    const handle = this.registry.get(channel);

    if (!handle) {
      this.send({ type: "error", channel, code: "unknown_channel" });

      return;
    }
    this.registry.forget(channel);
    handle.close();
    this.send({ type: "closed", channel, reason: "client" });
  }

  /** The id is taken the moment the open arrives, so a second open for it while the first still verifies its token is refused rather than raced. */
  private open(message: OpenMessage): void {
    const { channel } = message;
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
    if (message.kind === "plan") {
      const request = webRequest(this.request);

      return Promise.resolve(
        openPlanChannel(message.channel, request, outlet, this.deps.collab),
      );
    }

    return openRunChannel(message, outlet, this.deps.run);
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
): void {
  new LiveConnection(ws, request, deps).start();
}
