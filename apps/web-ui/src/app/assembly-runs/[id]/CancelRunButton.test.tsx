// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { CancelRunButton } from "./CancelRunButton";

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

function askToConfirm() {
  fireEvent.click(screen.getByRole("button", { name: "Cancel run" }));
}

async function confirmCancel() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Confirm cancel" }));
  });
}

describe("CancelRunButton", () => {
  it("shows only the Cancel run trigger and asks nothing before it is clicked", () => {
    const fetchMock = answering(200, {});

    render(<CancelRunButton runId="plan-run" />);

    expect({
      trigger: screen.getByRole("button", { name: "Cancel run" }),
      confirm: screen.queryByRole("button", { name: "Confirm cancel" }),
      asked: fetchMock.mock.calls.length,
    }).toMatchObject({ confirm: null, asked: 0 });
  });

  it("asks Cancel this run? with Confirm cancel and Keep run once the trigger is clicked", () => {
    render(<CancelRunButton runId="plan-run" />);
    askToConfirm();

    expect({
      question: screen.getByText("Cancel this run?"),
      confirm: screen.getByRole("button", { name: "Confirm cancel" }),
      keep: screen.getByRole("button", { name: "Keep run" }),
      trigger: screen.queryByRole("button", { name: "Cancel run" }),
    }).toMatchObject({ trigger: null });
  });

  it("backs out to the trigger and asks nothing when Keep run is clicked", () => {
    const fetchMock = answering(200, {});

    render(<CancelRunButton runId="plan-run" />);
    askToConfirm();
    fireEvent.click(screen.getByRole("button", { name: "Keep run" }));

    expect({
      trigger: screen.getByRole("button", { name: "Cancel run" }),
      confirm: screen.queryByRole("button", { name: "Confirm cancel" }),
      asked: fetchMock.mock.calls.length,
    }).toMatchObject({ confirm: null, asked: 0 });
  });

  it("posts to the plan-run cancel proxy and refreshes the page once the floor cancelled it", async () => {
    const fetchMock = answering(200, { cancelled: true, run_id: "plan-run" });

    render(<CancelRunButton runId="plan-run" />);
    askToConfirm();
    await confirmCancel();

    expect({
      url: fetchMock.mock.calls[0][0],
      method: fetchMock.mock.calls[0][1].method,
      refreshed: refresh.mock.calls.length,
    }).toEqual({
      url: "/api/assembly-runs/plan-run/cancel",
      method: "POST",
      refreshed: 1,
    });
  });

  it("shows the refusal beside the button and refreshes nothing on a 409", async () => {
    answering(409, { error: "run plan-run already finished" });

    render(<CancelRunButton runId="plan-run" />);
    askToConfirm();
    await confirmCancel();

    expect({
      shown: screen.getByText("run plan-run already finished"),
      refreshed: refresh.mock.calls.length,
    }).toMatchObject({ refreshed: 0 });
  });

  it("reads a refusal with no message as cancel failed (404)", async () => {
    answering(404, {});

    render(<CancelRunButton runId="plan-run" />);
    askToConfirm();
    await confirmCancel();

    expect(screen.getByText("cancel failed (404)")).toBeInTheDocument();
  });
});
