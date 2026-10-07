// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import type { RunsChannelOptions } from "@/app/assembly-runs/useRunsChannel";
import LoopRunsFollower from "./LoopRunsFollower";

const refresh = vi.fn();
const channels: RunsChannelOptions[] = [];

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/assembly-runs/useRunsChannel", () => ({
  useRunsChannel: (options: RunsChannelOptions) => {
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

describe("LoopRunsFollower", () => {
  it("re-reads the page once run-42 changes, even across two frames", () => {
    render(<LoopRunsFollower runIds={["run-42"]} />);
    act(() => {
      channels[0]?.onFrame(frame("run_row"));
      channels[0]?.onFrame(frame("run_row"));
      vi.advanceTimersByTime(300);
    });

    expect({
      watched: channels[0]?.runIds,
      refreshes: refresh.mock.calls.length,
    }).toEqual({ watched: ["run-42"], refreshes: 1 });
  });

  it("re-reads on a resync, since a gap may have changed a watched run", () => {
    render(<LoopRunsFollower runIds={["run-42"]} />);
    act(() => {
      channels[0]?.onFrame(frame("resync"));
      vi.advanceTimersByTime(300);
    });

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("leaves the page alone for a run starting elsewhere", () => {
    render(<LoopRunsFollower runIds={["run-42"]} />);
    act(() => {
      channels[0]?.onFrame(frame("run_started"));
      vi.advanceTimersByTime(300);
    });

    expect(refresh).not.toHaveBeenCalled();
  });
});
