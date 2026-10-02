// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NodeInspectorPanel } from "./NodeInspectorPanel";
import type { NodeRunState } from "@/lib/run-event-reducer";

vi.mock("./FullTranscriptPanel", () => ({
  default: ({ nodeStatus }: { nodeStatus?: string }) => (
    <p data-testid="transcript">{nodeStatus ?? "no status"}</p>
  ),
}));
vi.mock("./NodeLogPanel", () => ({ default: () => null }));
vi.mock("./NodeInputCard", () => ({ default: () => null }));
vi.mock("./RunNodeDetail", () => ({ default: () => null }));
vi.mock("./RerunNodeButton", () => ({ RerunNodeButton: () => null }));
vi.mock("./RunStationButton", () => ({ RunStationButton: () => null }));

function state(status: NodeRunState["status"]): NodeRunState {
  return { status, iteration: 1, transcript: [], droppedCount: 0 };
}

function renderInspector(selectedState: NodeRunState | null) {
  return render(
    <NodeInspectorPanel
      selectedNodeId="implement"
      runId="run-1"
      repo="re-cinq/lore"
      reason={null}
      definition={null}
      selectedState={selectedState}
      latestRows={new Map()}
      selectedRows={[]}
      selectedAttempts={[]}
      nodeInputs={[]}
      retrySource={null}
      runActions={false}
      runState="live"
      visibleNodeCount={2}
    />,
  );
}

describe("NodeInspectorPanel", () => {
  it("hands the transcript the selected node's status", () => {
    for (const status of ["running", "idle", "succeeded", "failed"] as const) {
      const { unmount } = renderInspector(state(status));

      expect(screen.getByTestId("transcript")).toHaveTextContent(status);
      unmount();
    }
  });

  it("hands the transcript no status when the node has no state", () => {
    renderInspector(null);

    expect(screen.getByTestId("transcript")).toHaveTextContent("no status");
  });
});
