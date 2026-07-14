// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SpecStatusChips from "./SpecStatusChips";

describe("SpecStatusChips", () => {
  it("renders nothing when no status has a positive count", () => {
    const { container } = render(
      <SpecStatusChips counts={{}} total={0} active="all" onChange={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders an All chip plus one chip per present status, in status order", () => {
    render(
      <SpecStatusChips
        counts={{ shipped: 4, draft: 5 }}
        total={9}
        active="all"
        onChange={vi.fn()}
      />,
    );
    const labels = screen
      .getAllByRole("button")
      .map((b) => b.textContent?.replace(/\s+/g, " ").trim());

    expect(labels).toEqual(["All (9)", "Draft (5)", "Shipped (4)"]);
  });

  it("shows the true list length in the All chip, not the sum of parsed statuses", () => {
    render(
      <SpecStatusChips
        counts={{ draft: 5, shipped: 4 }}
        total={12}
        active="all"
        onChange={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: /All \(12\)/ }),
    ).toBeInTheDocument();
  });

  it("marks the active filter chip aria-pressed and leaves the others unpressed", () => {
    render(
      <SpecStatusChips
        counts={{ draft: 2, shipped: 1 }}
        total={3}
        active="draft"
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /Draft/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /All/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("calls onChange with the status branch when a status chip is clicked", () => {
    const onChange = vi.fn();

    render(
      <SpecStatusChips
        counts={{ draft: 2, shipped: 1 }}
        total={3}
        active="all"
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Shipped/ }));

    expect(onChange).toHaveBeenCalledWith("shipped");
  });

  it("renders the legend distinguishing status from coverage", () => {
    render(
      <SpecStatusChips
        counts={{ draft: 1 }}
        total={1}
        active="all"
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText(/Coverage = statements validated/)).toBeTruthy();
  });
});
