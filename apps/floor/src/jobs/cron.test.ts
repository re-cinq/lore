import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const pruneHandled = vi.fn<(days: number) => Promise<number>>();
const pruneOld = vi.fn<(days: number) => Promise<number>>();

vi.mock("../main-loop/store.js", () => ({
  pruneHandled: (days: number) => pruneHandled(days),
}));

vi.mock("../kernel/queues.js", () => ({
  agentRunEvents: () => ({ pruneOld: (days: number) => pruneOld(days) }),
  agentRunTurns: () => ({ pruneOld: async () => 0 }),
}));

const { eventsPrune } = await import("./cron.js");

const tick = { id: "1", name: "cron.events_prune.tick" };

beforeEach(() => {
  pruneHandled.mockReset().mockResolvedValue(0);
  pruneOld.mockReset().mockResolvedValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("eventsPrune", () => {
  it("prunes agent run events older than 14 days alongside handled events", async () => {
    await eventsPrune(tick as never);

    expect(pruneHandled).toHaveBeenCalledWith(7);
    expect(pruneOld).toHaveBeenCalledWith(14);
  });

  it("logs the deleted agent run event count when non-zero", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    pruneOld.mockResolvedValueOnce(3);
    await eventsPrune(tick as never);

    expect(
      log.mock.calls.some((c) => String(c[0]).includes("3 agent run event")),
    ).toBe(true);
  });

  it("logs nothing for agent run events when none were deleted", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await eventsPrune(tick as never);

    expect(
      log.mock.calls.some((c) => String(c[0]).includes("agent run event")),
    ).toBe(false);
  });
});
