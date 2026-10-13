// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { RunChannelOptions } from "@/app/assembly-runs/[id]/useRunChannel";
import type { PlanActions } from "./plan-actions";
import type { PlanRun } from "./PlanRunCard";
import { usePlanRunLive } from "./usePlanRunLive";

const channels: RunChannelOptions[] = [];

vi.mock("@/app/assembly-runs/[id]/useRunChannel", () => ({
  useRunChannel: (options: RunChannelOptions) => {
    channels.push(options);
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  channels.length = 0;
});

afterEach(() => vi.useRealTimers());

const RUN: PlanRun = {
  id: "run-1",
  status: "running",
  outcome: null,
  reason: null,
  issueUrl: null,
  issueNumber: null,
  prUrl: null,
  prNumber: null,
  prTitle: null,
  prUnresolvedThreads: null,
  specPlanSummary: "CHANGES REQUESTED. Which scope?",
  nodes: [],
};

function nodeStatus(outcome: string | null) {
  return {
    type: "node_status",
    node: {
      node_id: "analyse-specs",
      iteration: 0,
      outcome,
      agent_cr_name: null,
      station_run_id: null,
      produced: null,
      route_url: null,
      worker: null,
      requested_by: null,
      input: null,
      commit_sha: null,
      started_at: "2026-10-08T10:00:00.000Z",
      finished_at: null,
      status: outcome ? "finished" : "running",
      claimed_at: null,
    },
  } as never;
}

describe("usePlanRunLive", () => {
  it("opens the run-1 channel when the seed run is still running", () => {
    renderHook(() => usePlanRunLive(RUN, refreshStub()));

    expect({
      runId: channels[0]?.runId,
      enabled: channels[0]?.enabled,
    }).toEqual({ runId: "run-1", enabled: true });
  });

  it("opens no channel once the seed run has already finished", () => {
    const finished: PlanRun = { ...RUN, status: "finished" };

    renderHook(() => usePlanRunLive(finished, refreshStub()));

    expect(channels[0]?.enabled).toBe(false);
  });

  it("folds an open node_status frame into nodes without calling refreshRunFacts", () => {
    const refresh = refreshStub();
    const { result } = renderHook(() => usePlanRunLive(RUN, refresh));

    act(() => channels[0]?.onFrame(nodeStatus(null)));

    expect({
      nodes: result.current?.nodes,
      refreshCalls: refresh.mock.calls.length,
    }).toEqual({
      nodes: [
        expect.objectContaining({ nodeId: "analyse-specs", outcome: null }),
      ],
      refreshCalls: 0,
    });
  });

  it("re-reads run facts once after analyse-specs settles with a new question, merging the result in", async () => {
    const refresh = refreshStub({
      run: { ...RUN, specPlanSummary: "CHANGES REQUESTED. Which repo?" },
    });
    const { result } = renderHook(() => usePlanRunLive(RUN, refresh));

    await act(async () => {
      channels[0]?.onFrame(nodeStatus("changes_requested"));
      await vi.advanceTimersByTimeAsync(300);
    });

    expect({
      specPlanSummary: result.current?.specPlanSummary,
      refreshCalls: refresh.mock.calls.length,
    }).toEqual({
      specPlanSummary: "CHANGES REQUESTED. Which repo?",
      refreshCalls: 1,
    });
  });

  it("adopts a freshly server-rendered seed, dropping what the socket folded in for the old one", () => {
    const { result, rerender } = renderHook(
      ({ seed }: { seed: PlanRun | null }) =>
        usePlanRunLive(seed, refreshStub()),
      { initialProps: { seed: RUN } },
    );

    act(() => channels[0]?.onFrame(nodeStatus(null)));
    expect(result.current?.nodes).toHaveLength(1);

    const approved: PlanRun = { ...RUN, status: "finished", nodes: [] };

    rerender({ seed: approved });

    expect({
      status: result.current?.status,
      nodes: result.current?.nodes,
    }).toEqual({ status: "finished", nodes: [] });
  });

  it("debounces two settling frames in the same burst into a single refreshRunFacts call", async () => {
    const refresh = refreshStub();

    renderHook(() => usePlanRunLive(RUN, refresh));

    await act(async () => {
      channels[0]?.onFrame(nodeStatus("changes_requested"));
      channels[0]?.onFrame({
        type: "run_status",
        run: {
          status: "running",
          outcome: null,
          reason: null,
          started_at: null,
          finished_at: null,
        },
      } as never);
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(refresh.mock.calls.length).toBe(1);
  });
});

function refreshStub(
  response: Awaited<ReturnType<PlanActions["refreshRunFacts"]>> = { run: RUN },
) {
  return vi.fn(async () => response);
}
