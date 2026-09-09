import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const pruneHandled = vi.fn<(days: number) => Promise<number>>();
const pruneOld = vi.fn<(days: number) => Promise<number>>();
const pruneTurns = vi.fn<(days: number) => Promise<number>>();

const orphanedEvents =
  vi.fn<
    (minutes: number) => Promise<{ event_name: string; count: number }[]>
  >();

const deadLettered = vi.fn<
  (minutes: number) => Promise<
    {
      event_name: string;
      subscriber: string;
      count: number;
      last_error: string | null;
    }[]
  >
>();

vi.mock("../../outbound/event-store.js", () => ({
  pruneHandled: (days: number) => pruneHandled(days),
  orphanedEvents: (minutes: number) => orphanedEvents(minutes),
  deadLettered: (minutes: number) => deadLettered(minutes),
}));

vi.mock("../../outbound/queues.js", () => ({
  clusterAgent: () => ({}),
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
  orphanedEvents.mockReset().mockResolvedValue([]);
  deadLettered.mockReset().mockResolvedValue([]);
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
    // eslint-disable-next-line re-lint/declare-near-use -- the spy must be installed before the eventsPrune calls it records
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

describe("eventsPrune orphan report", () => {
  it("names every event that reached no subscriber, with its count", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    orphanedEvents.mockResolvedValue([
      { event_name: "internal.repo.team_changed", count: 3 },
      { event_name: "github.issues.labeled", count: 1 },
    ]);
    await eventsPrune({}, { eventId: "1" });

    expect(err.mock.calls[0]?.[0]).toContain(
      "internal.repo.team_changed x3, github.issues.labeled x1",
    );
  });

  it("says nothing when every event reached a subscriber", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    await eventsPrune({}, { eventId: "1" });

    expect(err).not.toHaveBeenCalled();
  });

  it("names each handler that gave up, with its count and the error that ended it", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    deadLettered.mockResolvedValue([
      {
        event_name: "cron.agent_watcher_reconcile.tick",
        subscriber: "floor",
        count: 60,
        last_error: "fetch failed",
      },
    ]);
    await eventsPrune({}, { eventId: "1" });

    expect(err.mock.calls[0]?.[0]).toContain(
      "cron.agent_watcher_reconcile.tick x60 (fetch failed)",
    );
  });

  it("reports a dead-lettered delivery whose error was never recorded", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    deadLettered.mockResolvedValue([
      {
        event_name: "cron.merge_check.tick",
        subscriber: "floor",
        count: 1,
        last_error: null,
      },
    ]);
    await eventsPrune({}, { eventId: "1" });

    expect(err.mock.calls[0]?.[0]).toContain(
      "cron.merge_check.tick x1 (no error)",
    );
  });

  it("looks back exactly one hour, matching its own tick, so no window is skipped or doubled", async () => {
    await eventsPrune({}, { eventId: "1" });

    expect(orphanedEvents).toHaveBeenCalledWith(60);
  });
});
