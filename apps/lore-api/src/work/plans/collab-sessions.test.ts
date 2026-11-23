import { describe, expect, it, vi } from "vitest";
import { closeCollabSession } from "./collab-sessions.js";

function connection(sessionId: string | undefined) {
  return {
    context: { user: { id: "u", sessionId } },
    webSocket: { close: vi.fn() },
  };
}

describe("closeCollabSession", () => {
  it("closes the open collaboration connections minted for the ended session and leaves others open", () => {
    const ended = connection("s1");
    const other = connection("s2");
    const unbound = connection(undefined);
    const collab = {
      documents: new Map([
        ["doc", { getConnections: () => [ended, other, unbound] }],
      ]),
    };

    closeCollabSession(collab, "s1");

    expect({
      ended: ended.webSocket.close.mock.calls,
      other: other.webSocket.close.mock.calls.length,
      unbound: unbound.webSocket.close.mock.calls.length,
    }).toEqual({ ended: [[4401, "session ended"]], other: 0, unbound: 0 });
  });
});
