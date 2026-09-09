// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RunWorkbenchLayout } from "./RunWorkbenchLayout";

function renderLayout() {
  return render(
    <RunWorkbenchLayout
      graph={<div data-testid="graph">graph</div>}
      inspector={<div data-testid="inspector">inspector</div>}
      below={<div data-testid="below">below</div>}
    />,
  );
}

const FOLLOWS = Node.DOCUMENT_POSITION_FOLLOWING;

describe("RunWorkbenchLayout", () => {
  it("names the inspector a region rather than a sidebar complementary to the graph", () => {
    renderLayout();

    expect(screen.queryByRole("complementary")).toBeNull();
    expect(
      screen.getByRole("region", { name: "Selected node" }),
    ).toContainElement(screen.getByTestId("inspector"));
  });

  it("orders the graph, then the inspector under it, then the run-wide sections", () => {
    renderLayout();
    const graph = screen.getByTestId("graph");
    const inspector = screen.getByTestId("inspector");

    expect(graph.compareDocumentPosition(inspector) & FOLLOWS).toBe(FOLLOWS);
    expect(
      inspector.compareDocumentPosition(screen.getByTestId("below")) & FOLLOWS,
    ).toBe(FOLLOWS);
  });
});
