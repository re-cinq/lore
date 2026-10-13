// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { RunNodeButton } from "./RunNodeButton";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockClear();
});

function answering(status: number, body: object) {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));

  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

async function clickRun() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Run this station" }));
  });
}

describe("RunNodeButton", () => {
  it("posts to the run-1 review proxy and refreshes the page once the floor took it", async () => {
    const fetchMock = answering(202, { run_id: "run-1", pending: false });

    render(<RunNodeButton runId="run-1" nodeId="review" />);
    await clickRun();

    expect({
      url: fetchMock.mock.calls[0][0],
      method: fetchMock.mock.calls[0][1].method,
      refreshed: refresh.mock.calls.length,
    }).toEqual({
      url: "/api/assembly-runs/run-1/nodes/review/run",
      method: "POST",
      refreshed: 1,
    });
  });

  it("says the floor has not started it yet when the answer is pending, and still refreshes", async () => {
    answering(202, { run_id: "run-1", pending: true });

    render(<RunNodeButton runId="run-1" nodeId="review" />);
    await clickRun();

    expect({
      note:
        screen.getByText("Asked the floor; it has not started yet") !== null,
      refreshed: refresh.mock.calls.length,
    }).toEqual({ note: true, refreshed: 1 });
  });

  it("shows the floor's refusal inline and refreshes nothing", async () => {
    answering(409, { error: "node review of run run-1 is already running" });

    render(<RunNodeButton runId="run-1" nodeId="review" />);
    await clickRun();

    expect({
      refusal:
        screen.getByText("node review of run run-1 is already running") !==
        null,
      refreshed: refresh.mock.calls.length,
    }).toEqual({ refusal: true, refreshed: 0 });
  });

  it("cancels its click and keeps it from the card summary it sits in", async () => {
    answering(202, { run_id: "run-1", pending: false });
    const summaryClicked = vi.fn();

    render(
      <div onClick={summaryClicked}>
        <RunNodeButton runId="run-1" nodeId="review" />
      </div>,
    );
    let cancelled = false;

    await act(async () => {
      cancelled = !fireEvent.click(
        screen.getByRole("button", { name: "Run this station" }),
      );
    });

    expect({
      cancelled,
      summaryClicked: summaryClicked.mock.calls.length,
    }).toEqual({
      cancelled: true,
      summaryClicked: 0,
    });
  });
});
