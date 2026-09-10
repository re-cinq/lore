// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SpendCompareBars } from "./SpendCompareBars";

const usd = (n: number) =>
  Number(n).toLocaleString(undefined, { style: "currency", currency: "USD" });

describe("SpendCompareBars", () => {
  const mixed = [
    { label: "LLM (Anthropic)", estimate: 24.02, billed: 21.4 },
    { label: "Kubernetes vs GCP", estimate: 30.5, billed: null },
  ];

  it("shows the label and both figures for a pair that has a billed side", () => {
    render(<SpendCompareBars pairs={mixed} />);

    expect(screen.getByText("LLM (Anthropic)")).toBeInTheDocument();
    expect(screen.getByText(usd(24.02))).toBeInTheDocument();
    expect(screen.getByText(usd(21.4))).toBeInTheDocument();
  });

  it("omits a pair that has no billed figure to compare against", () => {
    render(<SpendCompareBars pairs={mixed} />);

    expect(screen.queryByText("Kubernetes vs GCP")).toBeNull();
  });

  it("renders nothing when no pair has a billed side", () => {
    const { container } = render(
      <SpendCompareBars
        pairs={[{ label: "LLM (Anthropic)", estimate: 24.02, billed: null }]}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("draws an estimate bar and a billed bar for each comparable pair", () => {
    const { container } = render(
      <SpendCompareBars
        pairs={[{ label: "LLM (Anthropic)", estimate: 24.02, billed: 21.4 }]}
      />,
    );

    expect(container.querySelectorAll("rect")).toHaveLength(2);
  });
});
