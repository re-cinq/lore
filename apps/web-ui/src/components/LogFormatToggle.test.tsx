// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import LogFormatToggle from "./LogFormatToggle";

describe("LogFormatToggle", () => {
  it("marks Formatted pressed when raw is false and Raw pressed when true", () => {
    const { rerender } = render(
      <LogFormatToggle raw={false} onChange={() => undefined} />,
    );

    expect(screen.getByRole("button", { name: "Formatted" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Raw" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    rerender(<LogFormatToggle raw={true} onChange={() => undefined} />);
    expect(screen.getByRole("button", { name: "Raw" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("calls onChange(true) when Raw is clicked and onChange(false) when Formatted is clicked", () => {
    const onChange = vi.fn();

    render(<LogFormatToggle raw={false} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Raw" }));
    expect(onChange).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByRole("button", { name: "Formatted" }));
    expect(onChange).toHaveBeenCalledWith(false);
  });
});
