// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import NodeNeedsCard from "./NodeNeedsCard";

describe("NodeNeedsCard", () => {
  it("lists target and pr_url with their refs for attempt 3", () => {
    render(
      <NodeNeedsCard
        iteration={3}
        needs={{
          target: "github.com/re-cinq/lore@main",
          pr_url: "https://github.com/re-cinq/lore/pull/412",
        }}
      />,
    );

    expect(screen.getByText("Needs")).toBeInTheDocument();
    expect(screen.getByText("attempt 3")).toBeInTheDocument();
    expect(screen.getByText("target").nextElementSibling).toHaveTextContent(
      "github.com/re-cinq/lore@main",
    );
  });

  it("says an attempt handed nothing was handed nothing", () => {
    render(<NodeNeedsCard iteration={1} needs={{}} />);

    expect(
      screen.getByText("This attempt was handed nothing."),
    ).toBeInTheDocument();
  });

  it("renders no card for a visit that recorded no needs", () => {
    const { container } = render(<NodeNeedsCard iteration={1} needs={null} />);

    expect(container).toBeEmptyDOMElement();
  });
});
