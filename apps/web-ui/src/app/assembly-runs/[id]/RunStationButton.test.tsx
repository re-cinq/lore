// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, fireEvent, within } from "@testing-library/react";
import { RunStationButton } from "./RunStationButton";

afterEach(() => {
  vi.unstubAllGlobals();
});

const renderLive = () =>
  render(<RunStationButton runId="run-1" nodeId="write" runState="live" />);
const renderEnded = () =>
  render(<RunStationButton runId="run-1" nodeId="write" runState="ended" />);

async function ask() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Run this station" }));
  });
}

async function confirm() {
  await act(async () => {
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Run" }),
    );
  });
}

describe("RunStationButton", () => {
  it("posts run_id and node_id to the run-station proxy only after the popup is confirmed", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ id: "fresh-9" }) });

    vi.stubGlobal("fetch", fetchMock);
    renderLive();
    await ask();
    const asked = fetchMock.mock.calls.length;

    await confirm();
    const [url, init] = fetchMock.mock.calls[0];

    expect({
      asked,
      url: String(url),
      body: Object.fromEntries(init.body as URLSearchParams),
    }).toEqual({
      asked: 0,
      url: "/api/assembly-runs/run-station",
      body: { run_id: "run-1", node_id: "write" },
    });
  });

  it("warns that a live run is retired, and says only that a fresh run starts for one that ended", async () => {
    renderLive();
    await ask();
    const live = screen.getByRole("dialog").textContent;

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    renderEnded();
    await act(async () => {
      fireEvent.click(
        screen.getAllByRole("button", { name: "Run this station" })[1],
      );
    });

    expect({
      live: live?.includes("it is retired and a fresh run starts at write"),
      ended: screen.getByRole("dialog").textContent?.includes("it is retired"),
    }).toEqual({ live: true, ended: false });
  });

  it("shows the proxy's refusal inline and re-enables the button", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ error: "another run is already working plan:p1" }),
      }),
    );
    renderLive();
    await ask();
    await confirm();

    expect({
      error:
        screen.getByText("another run is already working plan:p1") !== null,
      enabled: (
        screen.getByRole("button", {
          name: "Run this station",
        }) as HTMLButtonElement
      ).disabled,
    }).toEqual({ error: true, enabled: false });
  });
});
