// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import SpecStatusPill from "./SpecStatusPill";

describe("SpecStatusPill", () => {
  it("renders the status label", () => {
    render(<SpecStatusPill status={{ status: "shipped", label: "Shipped" }} />);

    expect(screen.getByText("Shipped")).toBeInTheDocument();
  });

  it("sets the pill color variable from the status bucket", () => {
    render(
      <SpecStatusPill status={{ status: "rejected", label: "Superseded" }} />,
    );
    const pill = screen.getByText("Superseded");

    expect(pill.style.getPropertyValue("--pill-color")).toBe("var(--danger)");
  });
});
