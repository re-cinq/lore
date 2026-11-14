// The door to the live socket (ADR-048): which upgrades /api/ws admits, under a global socket ceiling and, where the client address is known, a per-address cap and upgrade rate.

import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { WebSocket, WebSocketServer } from "ws";
import { LIVE_SOCKET_PATH } from "./protocol.js";
import { originAllowed, sessionCookieOf } from "./socket-session.js";
import { urlOf } from "./web-request.js";

const FORBIDDEN = "403 Forbidden";
const MAX_SOCKETS = 2_000;
const MAX_SOCKETS_PER_ADDRESS = 20;

export interface LiveSocketLimits {
  addressOf(request: IncomingMessage): string | undefined;
  allowUpgrade(address: string): boolean;
  allowOpen(connection: string): boolean;
}

export interface UpgradeGateDeps {
  limits?: LiveSocketLimits;
  maxSockets?: number;
  maxSocketsPerAddress?: number;
}

interface PendingUpgrade {
  request: IncomingMessage;
  socket: Duplex;
  head: Buffer;
}

/** Another mount (the plans library's) shares the listener; a foreign path is its business and is left untouched. */
export class UpgradeGate<Deps extends UpgradeGateDeps> {
  private readonly held = new Map<string, number>();

  constructor(
    private readonly sockets: WebSocketServer,
    private readonly deps: Deps,
    private readonly serve: (
      ws: WebSocket,
      request: IncomingMessage,
      deps: Deps,
      sessionToken: string | undefined,
    ) => void,
  ) {}

  readonly onUpgrade = (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void => {
    if (urlOf(request).pathname !== LIVE_SOCKET_PATH) {
      return;
    }
    const address = this.addressOf(request);
    const sessionToken = sessionCookieOf(request.headers.cookie);
    const refusal =
      foreignSession(request, sessionToken) ?? this.refusal(address);

    if (refusal) {
      refuseUpgrade(socket, refusal);

      return;
    }
    this.accept({ request, socket, head }, address, sessionToken);
  };

  private accept(
    { request, socket, head }: PendingUpgrade,
    address: string | undefined,
    sessionToken: string | undefined,
  ): void {
    this.sockets.handleUpgrade(request, socket, head, (ws) => {
      this.admit(address);
      ws.on("close", () => this.release(address));
      this.serve(ws, request, this.deps, sessionToken);
    });
  }

  private addressOf(request: IncomingMessage): string | undefined {
    return this.deps.limits?.addressOf(request);
  }

  private refusal(address: string | undefined): string | null {
    if (this.sockets.clients.size >= (this.deps.maxSockets ?? MAX_SOCKETS)) {
      return "503 Service Unavailable";
    }

    return this.crowded(address) ? "429 Too Many Requests" : null;
  }

  private admit(address: string | undefined): void {
    if (address === undefined) {
      return;
    }
    this.held.set(address, (this.held.get(address) ?? 0) + 1);
  }

  private release(address: string | undefined): void {
    if (address === undefined) {
      return;
    }
    const remaining = (this.held.get(address) ?? 0) - 1;

    if (remaining > 0) {
      this.held.set(address, remaining);

      return;
    }
    this.held.delete(address);
  }

  private crowded(address: string | undefined): boolean {
    if (address === undefined) {
      return false;
    }
    const cap = this.deps.maxSocketsPerAddress ?? MAX_SOCKETS_PER_ADDRESS;

    return (
      (this.held.get(address) ?? 0) >= cap ||
      this.deps.limits?.allowUpgrade(address) === false
    );
  }
}

/** A cookie socket opened by another site would speak as the person: refused before it is admitted. */
function foreignSession(
  request: IncomingMessage,
  sessionToken: string | undefined,
): string | null {
  return sessionToken !== undefined && !originAllowed(request.headers.origin)
    ? FORBIDDEN
    : null;
}

function refuseUpgrade(socket: Duplex, status: string): void {
  const retryAfter = status === FORBIDDEN ? "" : "Retry-After: 60\r\n";

  socket.write(
    `HTTP/1.1 ${status}\r\n${retryAfter}Connection: close\r\nContent-Length: 0\r\n\r\n`,
  );
  socket.destroy();
}
