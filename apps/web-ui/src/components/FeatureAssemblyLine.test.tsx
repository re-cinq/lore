// @vitest-environment jsdom
//
// The planning pages show the machine that runs them. Same component both sides:
// with no run it is a preview of what "Start planning" sets in motion, with one it
// is the live walk.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FeatureAssemblyLine } from "./FeatureAssemblyLine";
import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";

const planning: AssemblyLineDefinition = {
  name: "feature-planning",
  description: "Plan a feature, write its spec, decompose it.",
  version: 1,
  entry: "analyze",
  exit: "done",
  nodes: [
    { id: "analyze", type: "agent" },
    { id: "author", type: "wait", signal: "author_feedback" },
    { id: "push", type: "agent" },
    { id: "merged", type: "wait", signal: "pr_merged" },
    { id: "done", type: "retrospective" },
  ],
  edges: [
    { from: "analyze", to: "author", on: "success" },
    { from: "author", to: "push", on: "success" },
    { from: "push", to: "merged", on: "always" },
    { from: "merged", to: "done", on: "success" },
  ],
};

describe("FeatureAssemblyLine", () => {
  it("draws the declared graph when there is no run yet", () => {
    render(<FeatureAssemblyLine definition={planning} />);
    expect(document.querySelector('[data-node="analyze"]')).toBeTruthy();
    expect(document.querySelector('[data-node="merged"]')).toBeTruthy();
    expect(
      document.querySelector('[data-edge="analyze->author"]'),
    ).toBeTruthy();
  });

  it("renders nothing at all when the definition could not be fetched", () => {
    // The Floor being down must not take the create form with it.
    const { container } = render(<FeatureAssemblyLine definition={null} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("names the line so the reader knows which machine this is", () => {
    render(<FeatureAssemblyLine definition={planning} />);
    expect(screen.getByText(/feature-planning/)).toBeInTheDocument();
  });

  it("carries the definition's own description as the summary hint", () => {
    render(<FeatureAssemblyLine definition={planning} />);
    expect(
      screen.getByText("Plan a feature, write its spec, decompose it."),
    ).toBeInTheDocument();
  });

  it("takes the caller's title, which the detail page relies on", () => {
    render(
      <FeatureAssemblyLine
        definition={planning}
        title="This feature's assembly line"
      />,
    );
    expect(
      screen.getByText("This feature's assembly line"),
    ).toBeInTheDocument();
  });

  it("suppresses the inner graph heading, which the card already provides", () => {
    // RunGraphView hardcodes an <h2>Graph</h2>; under "Plan a new feature" that
    // reads as a second, competing section title.
    render(<FeatureAssemblyLine definition={planning} />);
    expect(screen.queryByRole("heading", { name: "Graph" })).toBeNull();
  });
});
