// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import TaskRefreshProvider, {
  useCoordinatedRefresh,
} from "./TaskRefreshProvider";
import {
  COORDINATED_POLL_MS,
  STREAM_HEARTBEAT_POLL_MS,
  type LiveRunCandidate,
} from "./task-refresh-presenter";

import { LiveSocketProvider } from "@/lib/live-socket/LiveSocketProvider";
import { FakeWebSocket } from "@/lib/live-socket/fake-web-socket";
import type { RunStreamFrame } from "@/lib/run-stream-types";

vi.mock("@/app/assembly-runs/[id]/live-actions", () => ({
  openRunChannelAction: async () => ({ token: "tok" }),
}));

function useFakeSocket() {
  FakeWebSocket.reset();
}

async function openChannels() {
  await act(async () => {
    FakeWebSocket.latest.accept();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  await act(async () => {
    for (const open of FakeWebSocket.latest.opens) {
      FakeWebSocket.latest.receive({ type: "opened", channel: open.channel });
    }
  });
}

async function acceptSocket() {
  await act(async () => {
    FakeWebSocket.latest.accept();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function emitFrame(frame: RunStreamFrame) {
  await act(async () => {
    FakeWebSocket.latest.receive({
      type: "frame",
      channel: FakeWebSocket.latest.opens[0].channel,
      frame,
    });
  });
}

function streamEvent(id: string) {
  return {
    id,
    taskId: "task-1",
    agentCrName: null,
    assemblyLineId: "run-1",
    nodeId: "implement",
    iteration: 1,
    eventType: "tool_call",
    toolName: "Bash",
    toolUseId: null,
    isError: false,
    filePaths: [],
    summary: null,
    payload: {},
    createdAt: "2026-08-01T10:00:00.000Z",
  };
}

function liveRun(overrides: Partial<LiveRunCandidate> = {}): LiveRunCandidate {
  return {
    id: "run-1",
    status: "running",
    created_at: "2026-08-01T10:00:00Z",
    ...overrides,
  };
}

function Probe({
  refresh,
  active,
  label,
}: {
  refresh: () => void;
  active: boolean;
  label: string;
}) {
  const { live } = useCoordinatedRefresh(refresh, { active });

  return <span data-testid={`live-${label}`}>{String(live)}</span>;
}

function renderProvider(input: {
  runs?: LiveRunCandidate[];
  taskStatus?: string;
  probes: { refresh: () => void; active: boolean; label: string }[];
}) {
  const tree = (probes: typeof input.probes) => (
    <LiveSocketProvider url="ws://test/api/ws" socket={FakeWebSocket}>
      <TaskRefreshProvider
        taskId="task-1"
        taskStatus={input.taskStatus ?? "running"}
        runs={input.runs ?? []}
      >
        {probes.map((p) => (
          <Probe key={p.label} {...p} />
        ))}
      </TaskRefreshProvider>
    </LiveSocketProvider>
  );
  const result = render(tree(input.probes));

  return {
    ...result,
    rerenderProbes: (probes: typeof input.probes) =>
      result.rerender(tree(probes)),
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await flush();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ runs: [liveRun()] }),
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("coordinated polling", () => {
  it("never ticks when no panel is active", async () => {
    const refresh = vi.fn();

    renderProvider({ probes: [{ refresh, active: false, label: "a" }] });
    await flush();
    await advance(COORDINATED_POLL_MS * 6);

    expect(refresh).not.toHaveBeenCalled();
  });

  it("ticks the active panel and skips the inactive one on the same interval", async () => {
    const activeRefresh = vi.fn();
    const inactiveRefresh = vi.fn();

    renderProvider({
      probes: [
        { refresh: activeRefresh, active: true, label: "a" },
        { refresh: inactiveRefresh, active: false, label: "b" },
      ],
    });
    await flush();
    await advance(COORDINATED_POLL_MS);

    expect(activeRefresh).toHaveBeenCalledTimes(1);
    expect(inactiveRefresh).not.toHaveBeenCalled();

    await advance(COORDINATED_POLL_MS);
    expect(activeRefresh).toHaveBeenCalledTimes(2);
  });

  it("stops ticking after the last panel goes inactive", async () => {
    const refresh = vi.fn();
    const view = renderProvider({
      probes: [{ refresh, active: true, label: "a" }],
    });

    await flush();
    await advance(COORDINATED_POLL_MS);
    expect(refresh).toHaveBeenCalledTimes(1);

    view.rerenderProbes([{ refresh, active: false, label: "a" }]);
    await flush();
    await advance(COORDINATED_POLL_MS * 3);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("stops ticking after unmount", async () => {
    const refresh = vi.fn();
    const view = renderProvider({
      probes: [{ refresh, active: true, label: "a" }],
    });

    await flush();
    view.unmount();
    await advance(COORDINATED_POLL_MS * 3);

    expect(refresh).not.toHaveBeenCalled();
  });

  it("never auto-refreshes without a provider ancestor", async () => {
    const refresh = vi.fn();

    render(<Probe refresh={refresh} active label="solo" />);
    await flush();
    await advance(COORDINATED_POLL_MS * 3);

    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("stream lifecycle", () => {
  it("opens one run channel on the tab's socket for a running run", async () => {
    useFakeSocket();
    renderProvider({
      runs: [liveRun()],
      probes: [{ refresh: vi.fn(), active: true, label: "a" }],
    });
    await flush();
    await openChannels();

    expect(FakeWebSocket.latest.opens).toMatchObject([
      { kind: "run", subject: "run-1" },
    ]);
  });

  it("opens no channel when every run is terminal", async () => {
    useFakeSocket();
    renderProvider({
      runs: [liveRun({ status: "finished" })],
      probes: [{ refresh: vi.fn(), active: true, label: "a" }],
    });
    await flush();

    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("opens no channel when no panel is active", async () => {
    useFakeSocket();
    renderProvider({
      runs: [liveRun()],
      probes: [{ refresh: vi.fn(), active: false, label: "a" }],
    });
    await flush();

    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("closes the channel when the last panel goes inactive", async () => {
    useFakeSocket();
    const refresh = vi.fn();
    const view = renderProvider({
      runs: [liveRun()],
      probes: [{ refresh, active: true, label: "a" }],
    });

    await flush();
    await openChannels();
    view.rerenderProbes([{ refresh, active: false, label: "a" }]);
    await flush();

    expect(FakeWebSocket.latest.sent.at(-1)).toEqual({
      type: "close",
      channel: "c1",
    });
  });

  it("reports live to panels once the server opens the channel", async () => {
    useFakeSocket();
    const view = renderProvider({
      runs: [liveRun()],
      probes: [{ refresh: vi.fn(), active: true, label: "a" }],
    });

    await flush();
    expect(view.getByTestId("live-a").textContent).toBe("false");

    await openChannels();

    expect(view.getByTestId("live-a").textContent).toBe("true");
  });
});

describe("event-triggered refreshes", () => {
  it("does not refresh on the catch-up replay burst at mount", async () => {
    useFakeSocket();
    const refresh = vi.fn();

    renderProvider({
      runs: [liveRun()],
      probes: [{ refresh, active: true, label: "a" }],
    });
    await flush();
    await openChannels();

    for (let i = 1; i <= 5; i++) {
      await emitFrame({
        type: "agent_event",
        event: streamEvent(String(i)) as never,
      });
    }

    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes immediately past the gap and coalesces a burst into one trailing refresh", async () => {
    useFakeSocket();
    const refresh = vi.fn();

    renderProvider({
      runs: [liveRun()],
      probes: [{ refresh, active: true, label: "a" }],
    });
    await flush();
    await openChannels();

    await advance(3_000);
    await emitFrame({ type: "agent_event", event: streamEvent("1") as never });
    expect(refresh).toHaveBeenCalledTimes(1);

    await advance(1_000);
    await emitFrame({ type: "agent_event", event: streamEvent("2") as never });
    await emitFrame({ type: "agent_event", event: streamEvent("3") as never });
    expect(refresh).toHaveBeenCalledTimes(1);

    await advance(2_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("slows the interval to the heartbeat cadence while the stream is live", async () => {
    useFakeSocket();
    const refresh = vi.fn();

    renderProvider({
      runs: [liveRun()],
      probes: [{ refresh, active: true, label: "a" }],
    });
    await flush();
    await openChannels();

    await advance(COORDINATED_POLL_MS);
    expect(refresh).not.toHaveBeenCalled();

    await advance(STREAM_HEARTBEAT_POLL_MS - COORDINATED_POLL_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("falls back to coordinated polling after the socket gives up", async () => {
    useFakeSocket();
    const refresh = vi.fn();

    renderProvider({
      runs: [liveRun()],
      probes: [{ refresh, active: true, label: "a" }],
    });
    await flush();

    for (const delayMs of [1_000, 2_000, 4_000, 8_000, 16_000]) {
      await act(async () => {
        FakeWebSocket.latest.drop();
      });
      await advance(delayMs * 2);
    }
    await act(async () => {
      FakeWebSocket.latest.drop();
    });
    await flush();

    const callsAtOffline = refresh.mock.calls.length;

    await advance(COORDINATED_POLL_MS);
    expect(refresh.mock.calls.length).toBe(callsAtOffline + 1);
    expect(FakeWebSocket.instances.length).toBe(6);
  });
});

describe("run discovery", () => {
  it("discovers a run minted after mount and opens its channel", async () => {
    useFakeSocket();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ runs: [liveRun({ id: "run-9" })] }),
    });

    vi.stubGlobal("fetch", fetchMock);
    renderProvider({
      taskStatus: "pending",
      runs: [],
      probes: [{ refresh: vi.fn(), active: true, label: "a" }],
    });
    await flush();
    expect(FakeWebSocket.instances).toHaveLength(0);

    await advance(COORDINATED_POLL_MS);
    await openChannels();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tasks/task-1/runs",
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(FakeWebSocket.latest.opens).toMatchObject([{ subject: "run-9" }]);
  });

  it("detaches and returns to coordinated polling when the attached run turns terminal", async () => {
    useFakeSocket();
    const refresh = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ runs: [liveRun({ status: "finished" })] }),
    });

    vi.stubGlobal("fetch", fetchMock);
    renderProvider({
      runs: [liveRun()],
      probes: [{ refresh, active: true, label: "a" }],
    });
    await flush();
    await acceptSocket();
    expect(FakeWebSocket.latest.opens).toHaveLength(1);

    await advance(COORDINATED_POLL_MS);
    expect(FakeWebSocket.latest.sent.at(-1)).toEqual({
      type: "close",
      channel: "c1",
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    await advance(COORDINATED_POLL_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(FakeWebSocket.latest.opens).toHaveLength(1);
  });

  it("attaches a retry's fresh run in place of a finished one", async () => {
    useFakeSocket();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        runs: [
          liveRun({ id: "run-1", status: "finished" }),
          liveRun({ id: "run-2", created_at: "2026-08-01T12:00:00Z" }),
        ],
      }),
    });

    vi.stubGlobal("fetch", fetchMock);
    renderProvider({
      runs: [liveRun()],
      probes: [{ refresh: vi.fn(), active: true, label: "a" }],
    });
    await flush();
    await acceptSocket();
    expect(FakeWebSocket.latest.opens).toHaveLength(1);

    await advance(COORDINATED_POLL_MS);
    await acceptSocket();

    expect(FakeWebSocket.latest.sent.filter((m) => m.type === "close")).toEqual(
      [{ type: "close", channel: "c1" }],
    );
    expect(FakeWebSocket.latest.opens.map((o) => o.subject)).toEqual([
      "run-1",
      "run-2",
    ]);
  });

  it("does not discover for a task in a terminal status", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ runs: [] }),
    });

    vi.stubGlobal("fetch", fetchMock);
    renderProvider({
      taskStatus: "failed",
      runs: [],
      probes: [{ refresh: vi.fn(), active: true, label: "a" }],
    });
    await flush();
    await advance(COORDINATED_POLL_MS * 2);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps polling when the discovery response has no live run", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ runs: [liveRun({ status: "finished" })] }),
    });

    vi.stubGlobal("fetch", fetchMock);
    const refresh = vi.fn();

    renderProvider({
      taskStatus: "pending",
      runs: [],
      probes: [{ refresh, active: true, label: "a" }],
    });
    await flush();
    await advance(COORDINATED_POLL_MS);
    await advance(COORDINATED_POLL_MS);

    const runsCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith("/runs"),
    );

    expect(runsCalls).toHaveLength(2);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
