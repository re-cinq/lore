// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import NodeInputCard, { inputCardText } from "./NodeInputCard";
import type { NodeInputView } from "./NodeInputCard";

function input(over: Partial<NodeInputView> = {}): NodeInputView {
  return {
    iteration: 1,
    description: "review the PR, carefully",
    prompt: "you are a reviewer",
    params: null,
    repo: "o/r",
    ref: "feat/x",
    ...over,
  };
}

describe("NodeInputCard", () => {
  it("renders one collapsible card titled Input per recorded visit", () => {
    const { container } = render(
      <NodeInputCard inputs={[input(), input({ iteration: 2 })]} />,
    );

    expect(screen.getAllByText("Input")).toHaveLength(2);
    expect(container.querySelectorAll("details")).toHaveLength(2);
    expect(screen.getByText("iteration 2")).toBeInTheDocument();
  });

  it("renders the visit's description, prompt, params and clone ref as markdown text", () => {
    render(
      <NodeInputCard
        inputs={[input({ params: { job_ref: "spec_drift" }, prompt: null })]}
      />,
    );

    const card = screen.getByText("Input").closest("details");

    expect(card).toHaveTextContent("review the PR, carefully");
    expect(card).toHaveTextContent("job_ref: spec_drift");
    expect(card).toHaveTextContent("o/r @ feat/x");
  });

  it("renders **markdown** in the description as formatted prose", () => {
    render(
      <NodeInputCard
        inputs={[input({ description: "review **carefully**" })]}
      />,
    );

    expect(screen.getByText("carefully").tagName).toBe("STRONG");
  });

  it("renders nothing for a node with no recorded inputs", () => {
    const { container } = render(<NodeInputCard inputs={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("marks a truncated brief with a truncated label", () => {
    render(
      <NodeInputCard
        inputs={[input({ description: "review…[truncated, 12000 bytes]" })]}
      />,
    );

    expect(screen.getByText("truncated")).toBeInTheDocument();
  });
});

describe("inputCardText", () => {
  it("joins clone ref, description, prompt and params into one text flow", () => {
    expect(inputCardText(input({ params: { job_ref: "spec_drift" } }))).toEqual(
      "o/r @ feat/x\n\nreview the PR, carefully\n\nyou are a reviewer\n\njob_ref: spec_drift",
    );
  });
});
