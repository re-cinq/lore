// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import SpecStatusPill from "./SpecStatusPill";

describe("SpecStatusPill", () => {
  it("renders the bucket's canonical label", () => {
    render(<SpecStatusPill status="shipped" />);

    expect(screen.getByText("Shipped")).toBeInTheDocument();
  });

  it("sets the pill color variable from the status bucket", () => {
    render(<SpecStatusPill status="rejected" />);

    expect(
      screen.getByText("Rejected").style.getPropertyValue("--pill-color"),
    ).toBe("var(--danger)");
  });

  // The point of taking a bucket rather than a {status, label} pair: the colour
  // and the word can no longer disagree. A superseded spec is `retired` and says
  // "Retired" — it can no longer render "Superseded" in the rejected red.
  it("renders retired distinctly from rejected", () => {
    render(<SpecStatusPill status="retired" />);

    expect(
      screen.getByText("Retired").style.getPropertyValue("--pill-color"),
    ).toBe("var(--chart-neutral)");
  });
});
