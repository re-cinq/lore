// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RunWorkbenchLayout } from "./RunWorkbenchLayout";

function renderLayout(onResizeSide = vi.fn()) {
  return render(
    <RunWorkbenchLayout
      graph={<div data-testid="graph">graph</div>}
      center={<div data-testid="center">center</div>}
      side={<div data-testid="side">side</div>}
      below={<div data-testid="below">below</div>}
      sideWidth={420}
      onResizeSide={onResizeSide}
    />,
  );
}

const FOLLOWS = Node.DOCUMENT_POSITION_FOLLOWING;

describe("RunWorkbenchLayout", () => {
  it("names the selected-node panel a complementary aside beside the graph", () => {
    renderLayout();

    expect(
      screen.getByRole("complementary", { name: "Selected node" }),
    ).toContainElement(screen.getByTestId("side"));
  });

  it("orders the graph, then the attempt column under it, then the run-wide sections", () => {
    renderLayout();
    const graph = screen.getByTestId("graph");
    const center = screen.getByTestId("center");

    expect(graph.compareDocumentPosition(center) & FOLLOWS).toBe(FOLLOWS);
    expect(
      center.compareDocumentPosition(screen.getByTestId("below")) & FOLLOWS,
    ).toBe(FOLLOWS);
  });

  it("draws the panel 420px wide through the inspector-width custom property", () => {
    const { container } = renderLayout();
    const workbench = container.firstElementChild as HTMLElement;

    expect(workbench.style.getPropertyValue("--inspector-width")).toBe("420px");
  });

  it("exposes a vertical separator reporting the 420px width between 280 and 720", () => {
    renderLayout();

    expect(screen.getByRole("separator")).toMatchObject({
      ariaValueNow: "420",
      ariaValueMin: "280",
      ariaValueMax: "720",
    });
  });

  it("widens the panel to 436 on ArrowLeft at the separator", () => {
    const onResizeSide = vi.fn();

    renderLayout(onResizeSide);
    fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowLeft" });

    expect(onResizeSide).toHaveBeenCalledWith(436);
  });
});
