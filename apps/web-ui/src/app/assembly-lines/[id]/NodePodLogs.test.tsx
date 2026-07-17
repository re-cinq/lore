// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import NodePodLogs from "./NodePodLogs";
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

describe("NodePodLogs", () => {
  it("renders nothing when there are no nodes", () => {
    const { container } = render(
      <NodePodLogs assemblyLineId="run-1" nodes={[]} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders a collapsed panel per node without fetching until opened", () => {
    render(
      <NodePodLogs
        assemblyLineId="run-1"
        nodes={[
          { nodeId: "review", agentCrName: "a1b2c3d4-review" },
          { nodeId: "refine", agentCrName: "a1b2c3d4-refine" },
        ]}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Pod logs" }),
    ).toBeInTheDocument();
    expect(screen.getByText("review")).toBeInTheDocument();
    expect(screen.getByText("refine")).toBeInTheDocument();
  });

  it("renders formatted entries inside an opened panel serving the sample log", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(logsResponse(SAMPLE_LOG)));

    const { container } = render(
      <NodePodLogs
        assemblyLineId="run-1"
        nodes={[{ nodeId: "review", agentCrName: "a1b2c3d4-review" }]}
      />,
    );

    await openPanel(container);

    expect(screen.getByText(/^→ Bash: gh pr view 871/)).toBeInTheDocument();
    expect(
      screen.getByText("✓ finished — 3m 21s · $0.51 · 27 turns"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/estimated_tokens/)).not.toBeInTheDocument();
  });

  it("switches the open panel to the raw blob when Raw is clicked", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(logsResponse(SAMPLE_LOG)));

    const { container } = render(
      <NodePodLogs
        assemblyLineId="run-1"
        nodes={[{ nodeId: "review", agentCrName: "a1b2c3d4-review" }]}
      />,
    );

    await openPanel(container);
    fireEvent.click(screen.getByRole("button", { name: "Raw" }));

    expect(screen.getByText(/estimated_tokens/)).toBeInTheDocument();
    expect(
      screen.queryByText(/^→ Bash: gh pr view 871/),
    ).not.toBeInTheDocument();
  });

  it("keeps the '(no output yet)' placeholder when available logs are empty", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(logsResponse("")));

    const { container } = render(
      <NodePodLogs
        assemblyLineId="run-1"
        nodes={[{ nodeId: "review", agentCrName: "a1b2c3d4-review" }]}
      />,
    );

    await openPanel(container);

    expect(screen.getByText("(no output yet)")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Raw" }),
    ).not.toBeInTheDocument();
  });
});
