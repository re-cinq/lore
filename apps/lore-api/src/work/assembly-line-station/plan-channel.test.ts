import { describe, it, expect } from "vitest";
import type { LiveServerMessage } from "./protocol.js";
import { base64ToBytes } from "./protocol.js";
import type { ChannelOutlet } from "./run-channel.js";
import {
  openPlanChannel,
  type CollabServer,
  type TunnelSocket,
} from "./plan-channel.js";

function outlet() {
  const sent: LiveServerMessage[] = [];
  const self: ChannelOutlet & {
    sent: LiveServerMessage[];
    endedCount: number;
  } = {
    sent,
    endedCount: 0,
    send: (message) => sent.push(message),
    bufferedBytes: () => 0,
    ended: () => (self.endedCount += 1),
  };

  return self;
}

function doublingEchoCollab() {
  const state: {
    socket?: TunnelSocket;
    closes: unknown[];
    received: Uint8Array[];
  } = {
    closes: [],
    received: [],
  };
  const collab: CollabServer = {
    handleConnection: (socket) => {
      state.socket = socket;

      return {
        handleMessage: (bytes) => {
          state.received.push(bytes);
          socket.send(new Uint8Array([...bytes, ...bytes]));
        },
        handleClose: (event) => state.closes.push(event),
      };
    },
  };

  return { collab, state };
}

const request = new Request("http://host/api/ws");

describe("openPlanChannel", () => {
  it("says opened, hands client bytes to the collaboration server and tunnels its replies back as data", () => {
    const { collab, state } = doublingEchoCollab();
    const out = outlet();
    const handle = openPlanChannel("p", request, out, collab);

    handle.receive(new Uint8Array([1, 2]));
    const reply = out.sent[1];

    expect({
      received: state.received,
      opened: out.sent[0],
      reply: reply?.type === "data" ? base64ToBytes(reply.data) : reply,
    }).toEqual({
      received: [new Uint8Array([1, 2])],
      opened: { type: "opened", channel: "p" },
      reply: new Uint8Array([1, 2, 1, 2]),
    });
  });

  it("tells the collaboration server the client closed, once, when the socket closes the channel", () => {
    const { collab, state } = doublingEchoCollab();
    const handle = openPlanChannel("p", request, outlet(), collab);

    handle.close();

    expect(state.closes).toEqual([{ code: 1000, reason: "client" }]);
    expect(state.socket?.readyState).toBe(3);
  });

  it("relays a server-side close as a closed envelope with its code, unauthorized for 4401, and ends the channel", () => {
    const { collab, state } = doublingEchoCollab();
    const out = outlet();

    openPlanChannel("p", request, out, collab);
    state.socket?.close(4401, "Unauthorized");
    state.socket?.close(4401, "Unauthorized");

    expect(out.sent.at(-1)).toEqual({
      type: "closed",
      channel: "p",
      reason: "unauthorized",
      code: 4401,
    });
    expect(out.endedCount).toBe(1);
  });
});
