// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { RerunNodeButton } from "./RerunNodeButton";

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderButton() {
  return render(
    <RerunNodeButton runId="run-1" resumeNodeId="implement" resumeIteration={2} />,
  );
}

async function click() {
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Retry from this node" }),
    );
  });
}

describe("RerunNodeButton", () => {
  it("posts run_id, node_id and iteration to the rerun proxy over fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "fork-9" }),
    });

    vi.stubGlobal("fetch", fetchMock);
    renderButton();
    await click();

    const [url, init] = fetchMock.mock.calls[0];

    expect(String(url)).toBe("/api/assembly-runs/rerun");
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({
      run_id: "run-1",
      node_id: "implement",
      iteration: "2",
    });
  });

  it("shows the proxy's error inline and re-enables the button", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ error: "Access denied" }),
      }),
    );
    renderButton();
    await click();

    expect(screen.getByText("Access denied")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Retry from this node" }),
    ).toBeEnabled();
  });

  it("shows a network failure inline instead of navigating anywhere", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );
    renderButton();
    await click();

    expect(screen.getByText("network down")).toBeInTheDocument();
  });
});
