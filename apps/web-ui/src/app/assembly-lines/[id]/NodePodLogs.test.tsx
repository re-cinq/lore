// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import NodePodLogs from "./NodePodLogs";

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
});
