// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { FakeWebSocket } from "@/lib/live-socket/fake-web-socket";
import { LiveSocketProvider } from "@/lib/live-socket/LiveSocketProvider";
import type {
  LiveServerMessage,
  PlanRunFacts,
} from "@/lib/live-socket/protocol";
import { PLAN_RUN_DEADLINE_MS, usePlanRunChannel } from "./usePlanRunChannel";

const RUN_1: NonNullable<PlanRunFacts> = {
  id: "run-1",
  status: "running",
  outcome: null,
  reason: null,
  issue_url: "https://github.com/re-cinq/lore/issues/4",
  issue_number: 4,
  pr_url: null,
  pr_number: null,
  pr_title: null,
  pr_unresolved_threads: null,
  spec_plan_summary: null,
};

const analyzeVisit = (outcome: string | null) =>
  ({
    type: "node_status",
    node: {
      id: "visit-1",
      node_id: "analyze",
      iteration: 1,
      outcome,
      agent_cr_name: null,
      commit_sha: null,
      started_at: "2026-11-06T10:00:00.000Z",
      finished_at: null,
    },
  }) as never;

const NO_SOCKET = null;

const mint = vi.fn(async () => ({ token: "t-minted" }));

function follow(url: string | null = "ws://test/api/ws") {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <LiveSocketProvider url={url ?? undefined} socket={FakeWebSocket}>
      {children}
    </LiveSocketProvider>
  );

  return renderHook(
    ({ token }: { token: string }) => usePlanRunChannel("p1", token, mint),
    { wrapper, initialProps: { token: "t-page" } },
  );
}

async function socketUp(): Promise<string> {
  await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
  await act(async () => {
    await FakeWebSocket.latest.acceptAndOpenAll();
  });

  return FakeWebSocket.latest.opens.at(-1)!.channel;
}

async function serverSays(message: LiveServerMessage): Promise<void> {
  await act(async () => {
    FakeWebSocket.latest.receive(message);
  });
}

const flush = () =>
  act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

beforeEach(() => {
  FakeWebSocket.reset();
  mint.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("usePlanRunChannel", () => {
  it("opens plan p1's plan-run channel with the page's token and stays unknown until the first plan_run", async () => {
    const { result } = follow();

    await socketUp();

    expect({
      open: FakeWebSocket.latest.opens[0],
      state: result.current.state,
      run: result.current.run,
    }).toMatchObject({
      open: { kind: "plan-run", subject: "p1", token: "t-page" },
      state: "unknown",
      run: null,
    });
  });

  it("knows run-1 with its story #4 from the first plan_run, and folds an analyze visit into it", async () => {
    const { result } = follow();
    const channel = await socketUp();

    await serverSays({ type: "plan_run", channel, run: RUN_1 });
    await serverSays({ type: "frame", channel, frame: analyzeVisit(null) });

    expect({
      state: result.current.state,
      run: result.current.run,
    }).toMatchObject({
      state: "known",
      run: {
        id: "run-1",
        status: "running",
        issueUrl: "https://github.com/re-cinq/lore/issues/4",
        issueNumber: 4,
        nodes: [{ nodeId: "analyze", outcome: null }],
      },
    });
  });

  it("keeps run-1's visits when its facts change, and drops them when run-2 takes over", async () => {
    const { result } = follow();
    const channel = await socketUp();

    await serverSays({ type: "plan_run", channel, run: RUN_1 });
    await serverSays({
      type: "frame",
      channel,
      frame: analyzeVisit("success"),
    });
    await serverSays({
      type: "plan_run",
      channel,
      run: { ...RUN_1, pr_number: 7 },
    });
    const sameRun = result.current.run?.nodes.length;

    await serverSays({
      type: "plan_run",
      channel,
      run: { ...RUN_1, id: "run-2" },
    });

    expect({ sameRun, newRun: result.current.run?.nodes.length }).toEqual({
      sameRun: 1,
      newRun: 0,
    });
  });

  it("knows there is no run when the first plan_run carries none", async () => {
    const { result } = follow();
    const channel = await socketUp();

    await serverSays({ type: "plan_run", channel, run: null });

    expect({ state: result.current.state, run: result.current.run }).toEqual({
      state: "known",
      run: null,
    });
  });

  it("fails when no plan_run arrives within 15 seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = follow();

    await socketUp();
    await act(async () => {
      vi.advanceTimersByTime(PLAN_RUN_DEADLINE_MS);
    });

    expect(result.current.state).toBe("failed");
  });

  it("reopens once with a minted token when the page's token is refused, and fails on a second refusal", async () => {
    const { result } = follow();
    const channel = await socketUp();

    await serverSays({ type: "closed", channel, reason: "unauthorized" });
    await flush();
    const reopened = FakeWebSocket.latest.opens.at(-1);

    await act(async () => {
      FakeWebSocket.latest.receive({
        type: "closed",
        channel: reopened!.channel,
        reason: "unauthorized",
      });
    });

    expect({ reopened, state: result.current.state }).toMatchObject({
      reopened: { kind: "plan-run", token: "t-minted" },
      state: "failed",
    });
  });

  it("fails at once when no live socket is configured", () => {
    const { result } = follow(NO_SOCKET);

    expect(result.current.state).toBe("failed");
  });

  it("keeps showing run-1 when the channel ends after it was known", async () => {
    const { result } = follow();
    const channel = await socketUp();

    await serverSays({ type: "plan_run", channel, run: RUN_1 });
    await serverSays({ type: "closed", channel, reason: "not_found" });

    expect({ state: result.current.state, id: result.current.run?.id }).toEqual(
      {
        state: "known",
        id: "run-1",
      },
    );
  });

  it("opens the channel again with a minted token on retry, unknown until its plan_run", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = follow();

    await socketUp();
    await act(async () => {
      vi.advanceTimersByTime(PLAN_RUN_DEADLINE_MS);
    });
    act(() => result.current.retry());
    await flush();

    expect({
      state: result.current.state,
      reopen: FakeWebSocket.latest.opens.at(-1),
    }).toMatchObject({
      state: "unknown",
      reopen: { kind: "plan-run", token: "t-minted" },
    });
  });

  it("keeps plan p1's open channel when a refreshed page hands it a new token", async () => {
    const { rerender } = follow();

    await socketUp();
    rerender({ token: "t-refreshed" });
    await flush();

    expect({
      opens: FakeWebSocket.latest.opens.length,
      closes: FakeWebSocket.latest.sent.filter((m) => m.type === "close")
        .length,
    }).toEqual({ opens: 1, closes: 0 });
  });
});
