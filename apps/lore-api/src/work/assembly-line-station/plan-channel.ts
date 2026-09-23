// A `plan` channel: the collaboration server's bytes tunnelled through the live socket. The server sees a socket-shaped object whose `send` becomes a `data` envelope and whose `close` becomes a `closed` one; the client's `send` envelopes become its inbound messages. Auth stays where it is — the Hocuspocus handshake inside the tunnel carries the plan's collab token.

import type { ChannelHandle } from "./channel-registry.js";
import type { ChannelOutlet } from "./run-channel.js";
import { bytesToBase64 } from "./protocol.js";

/** What the collaboration server needs of a socket (Hocuspocus's own `WebSocketLike`). */
export interface TunnelSocket {
  readyState: number;
  send(data: string | ArrayBufferLike | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
}

/** One client's connection as the collaboration server hands it back. Method signatures on purpose: Hocuspocus types the close event more narrowly, and a method parameter may. */
export interface CollabConnection {
  handleMessage(data: Uint8Array): void;
  handleClose(event?: { code: number; reason: string }): void;
}

/** The slice of Hocuspocus the tunnel drives; `PlanningSync["collab"]` satisfies it. */
export interface CollabServer {
  handleConnection(socket: TunnelSocket, request: Request): CollabConnection;
}

const OPEN = 1;
const CLOSED = 3;

/** The client went away; the code the collaboration server sees for that. */
const CLIENT_CLOSE = { code: 1000, reason: "client" };

export function openPlanChannel(
  channel: string,
  request: Request,
  outlet: ChannelOutlet,
  collab: CollabServer,
): ChannelHandle {
  const socket = tunnelSocket(channel, outlet);
  const connection = collab.handleConnection(socket, request);

  outlet.send({ type: "opened", channel });

  return {
    receive: (bytes) => connection.handleMessage(bytes),
    close: () => {
      socket.readyState = CLOSED;
      connection.handleClose(CLIENT_CLOSE);
    },
  };
}

/** The socket the collaboration server writes to: its sends become `data` envelopes, its close a `closed` one, sent once. */
function tunnelSocket(channel: string, outlet: ChannelOutlet): TunnelSocket {
  const socket: TunnelSocket = {
    readyState: OPEN,
    send: (payload) =>
      outlet.send({
        type: "data",
        channel,
        data: bytesToBase64(toBytes(payload)),
      }),
    close: (code) => {
      if (socket.readyState === CLOSED) {
        return;
      }
      socket.readyState = CLOSED;
      outlet.send({ type: "closed", channel, reason: reasonFor(code), code });
      outlet.ended();
    },
  };

  return socket;
}

/** Hocuspocus closes with 4401 for a refused token; anything else is the server's own decision. */
function reasonFor(code: number | undefined): "unauthorized" | "server" {
  return code === 4401 ? "unauthorized" : "server";
}

function toBytes(
  payload: string | ArrayBufferLike | ArrayBufferView,
): Uint8Array {
  if (typeof payload === "string") {
    return new TextEncoder().encode(payload);
  }

  if (ArrayBuffer.isView(payload)) {
    return new Uint8Array(
      payload.buffer,
      payload.byteOffset,
      payload.byteLength,
    );
  }

  return new Uint8Array(payload);
}
