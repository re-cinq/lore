// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import NodeLogPanel from "./NodeLogPanel";
import { SAMPLE_LOG } from "@/lib/agent-log-entries.fixtures";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function logsResponse(logs: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      available: true,
      logs,
      phase: "Succeeded",
      podName: "pod-1",
    }),
  };
}

function renderPanel() {
  return render(
    <NodeLogPanel
      assemblyLineId="run-1"
      agentCrName="a1b2c3d4-review"
      label="Pod logs · attempt 1"
    />,
  );
}

async function openPanel(container: HTMLElement) {
  const details = container.querySelector("details");

  if (!details) {
    throw new Error("panel not rendered");
  }
  details.open = true;
  fireEvent(details, new Event("toggle"));

  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("NodeLogPanel", () => {
  it("renders the collapsed label without fetching until opened", () => {
    const fetchMock = vi.fn();

    vi.stubGlobal("fetch", fetchMock);

    renderPanel();

    expect(screen.getByText("Pod logs · attempt 1")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders formatted entries inside an opened panel serving the sample log", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(logsResponse(SAMPLE_LOG)));

    const { container } = renderPanel();

    await openPanel(container);

    expect(screen.getByText(/^→ Bash: gh pr view 871/)).toBeInTheDocument();
    expect(
      screen.getByText("✓ finished — 3m 21s · $0.51 · 27 turns"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/estimated_tokens/)).not.toBeInTheDocument();
  });

  it("switches the open panel to the raw blob when Raw is clicked", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(logsResponse(SAMPLE_LOG)));

    const { container } = renderPanel();

    await openPanel(container);
    fireEvent.click(screen.getByRole("button", { name: "Raw" }));

    expect(screen.getByText(/estimated_tokens/)).toBeInTheDocument();
    expect(
      screen.queryByText(/^→ Bash: gh pr view 871/),
    ).not.toBeInTheDocument();
  });

  it("keeps the '(no output yet)' placeholder when available logs are empty", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(logsResponse("")));

    const { container } = renderPanel();

    await openPanel(container);

    expect(screen.getByText("(no output yet)")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Raw" }),
    ).not.toBeInTheDocument();
  });
});
