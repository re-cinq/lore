// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import type { RunChannelOptions } from "@/app/assembly-runs/[id]/useRunChannel";
import PlanRunFollower from "./PlanRunFollower";

const refresh = vi.fn();
const channels: RunChannelOptions[] = [];

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/assembly-runs/[id]/useRunChannel", () => ({
  useRunChannel: (options: RunChannelOptions) => {
    channels.push(options);
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockClear();
  channels.length = 0;
});

afterEach(() => vi.useRealTimers());

const frame = (type: string) => ({ type }) as never;

describe("PlanRunFollower", () => {
  it("re-reads the page once when run-1's analyse-specs node settles and write opens", () => {
    render(<PlanRunFollower runId="run-1" live />);
    act(() => {
      channels[0]?.onFrame(frame("node_status"));
      channels[0]?.onFrame(frame("node_status"));
      vi.advanceTimersByTime(300);
    });

    expect({
      channel: { runId: channels[0]?.runId, enabled: channels[0]?.enabled },
      refreshes: refresh.mock.calls.length,
    }).toEqual({ channel: { runId: "run-1", enabled: true }, refreshes: 1 });
  });

  it("leaves the page alone for the transcript's agent events", () => {
    render(<PlanRunFollower runId="run-1" live />);
    act(() => {
      channels[0]?.onFrame(frame("agent_event"));
      vi.advanceTimersByTime(300);
    });

    expect(refresh).not.toHaveBeenCalled();
  });

  it("opens no channel on a run that already ended", () => {
    render(<PlanRunFollower runId="run-1" live={false} />);

    expect(channels[0]?.enabled).toBe(false);
  });
});
