import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const pruneHandled = vi.fn<(days: number) => Promise<number>>();
const pruneOld = vi.fn<(days: number) => Promise<number>>();
const pruneTurns = vi.fn<(days: number) => Promise<number>>();

vi.mock("../main-loop/store.js", () => ({
  pruneHandled: (days: number) => pruneHandled(days),
}));

vi.mock("../kernel/queues.js", () => ({
  pipeline: () => ({
    agentRunEvents: { pruneOld: (days: number) => pruneOld(days) },
    agentRunTurns: { pruneOld: (days: number) => pruneTurns(days) },
  }),
}));

const { eventsPrune } = await import("./cron.js");

const tick = { id: "1", name: "cron.events_prune.tick" };

beforeEach(() => {
  pruneHandled.mockReset().mockResolvedValue(0);
  pruneOld.mockReset().mockResolvedValue(0);
  pruneTurns.mockReset().mockResolvedValue(0);
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

describe("eventsPrune turn retention", () => {
  it("prunes agent run turns at 30 days, longer than the projection's 14", async () => {
    await eventsPrune(tick as never);

    expect(pruneTurns).toHaveBeenCalledWith(30);
    expect(pruneOld).toHaveBeenCalledWith(14);
  });

  it("logs the deleted agent run turn count when non-zero", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    pruneTurns.mockResolvedValueOnce(4);
    await eventsPrune(tick as never);

    expect(
      log.mock.calls.some((c) => String(c[0]).includes("4 agent run turn")),
    ).toBe(true);
  });
});

describe("eventsPrune turn retention override", () => {
  afterEach(() => {
    delete process.env.LORE_AGENT_RUN_TURN_RETENTION_DAYS;
  });

  it("prunes agent run turns at 90 days when LORE_AGENT_RUN_TURN_RETENTION_DAYS=90", async () => {
    process.env.LORE_AGENT_RUN_TURN_RETENTION_DAYS = "90";

    await eventsPrune(tick as never);

    expect(pruneTurns).toHaveBeenCalledWith(90);
  });

  it("falls back to 30 days with a warning when the override is not a positive integer within 3650", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    process.env.LORE_AGENT_RUN_TURN_RETENTION_DAYS = "0";
    await eventsPrune(tick as never);
    expect(pruneTurns).toHaveBeenCalledWith(30);

    pruneTurns.mockClear();
    process.env.LORE_AGENT_RUN_TURN_RETENTION_DAYS = "ninety";
    await eventsPrune(tick as never);
    expect(pruneTurns).toHaveBeenCalledWith(30);

    pruneTurns.mockClear();
    process.env.LORE_AGENT_RUN_TURN_RETENTION_DAYS = "99999999999999999";
    await eventsPrune(tick as never);
    expect(pruneTurns).toHaveBeenCalledWith(30);

    expect(warn).toHaveBeenCalledTimes(3);
    expect(String(warn.mock.calls[0]?.[0])).toContain(
      "LORE_AGENT_RUN_TURN_RETENTION_DAYS=0",
    );
  });
});
