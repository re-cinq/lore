import { afterEach, describe, expect, it, vi } from "vitest";
import { collabLivenessExtension } from "./collab-liveness.js";

function connection(sessionId: string) {
  return {
    context: { user: { id: "u", sessionId } },
    webSocket: { close: vi.fn() },
  };
}

describe("collabLivenessExtension", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("closes an open plan collaboration connection at the first frame after five minutes when its session ended without a notification", async () => {
    vi.useFakeTimers();
    const live = vi.fn().mockResolvedValue(false);
    const extension = collabLivenessExtension(live);
    const held = connection("s1");

    await extension.connected({ connection: held });
    vi.advanceTimersByTime(4 * 60_000);
    await extension.beforeHandleMessage({ connection: held });
    const closedEarly = held.webSocket.close.mock.calls.length;

    vi.advanceTimersByTime(2 * 60_000);
    await expect(
      extension.beforeHandleMessage({ connection: held }),
    ).rejects.toThrow(new Error("session ended"));

    expect({ closedEarly, live: live.mock.calls }).toEqual({
      closedEarly: 0,
      live: [["s1"]],
    });
    expect(held.webSocket.close).toHaveBeenCalledWith(4401, "session ended");
  });

  it("refuses the frame at the five-minute check when the session lookup fails, and asks again at the next frame", async () => {
    vi.useFakeTimers();
    const live = vi
      .fn()
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce(false);
    const extension = collabLivenessExtension(live);
    const held = connection("s1");

    await extension.connected({ connection: held });
    vi.advanceTimersByTime(6 * 60_000);
    await expect(
      extension.beforeHandleMessage({ connection: held }),
    ).rejects.toThrow("database unavailable");
    await expect(
      extension.beforeHandleMessage({ connection: held }),
    ).rejects.toThrow(new Error("session ended"));

    expect(live.mock.calls).toEqual([["s1"], ["s1"]]);
  });

  it("keeps the connection when the session is still live at the five-minute check, and asks again only after another five minutes", async () => {
    vi.useFakeTimers();
    const live = vi.fn().mockResolvedValue(true);
    const extension = collabLivenessExtension(live);
    const held = connection("s1");

    await extension.connected({ connection: held });
    vi.advanceTimersByTime(6 * 60_000);
    await extension.beforeHandleMessage({ connection: held });
    vi.advanceTimersByTime(4 * 60_000);
    await extension.beforeHandleMessage({ connection: held });
    const callsWithinNextWindow = [...live.mock.calls];

    vi.advanceTimersByTime(2 * 60_000);
    await extension.beforeHandleMessage({ connection: held });

    expect({
      callsWithinNextWindow,
      callsAfterSecondWindow: live.mock.calls,
      closes: held.webSocket.close.mock.calls,
    }).toEqual({
      callsWithinNextWindow: [["s1"]],
      callsAfterSecondWindow: [["s1"], ["s1"]],
      closes: [],
    });
  });
});
