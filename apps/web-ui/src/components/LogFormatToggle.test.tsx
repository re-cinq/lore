// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import LogFormatToggle from "./LogFormatToggle";

const noop = () => undefined;

describe("LogFormatToggle", () => {
  it("marks Formatted pressed when raw is false and Raw pressed when true", () => {
    const { rerender } = render(
      <LogFormatToggle raw={false} onFormatted={noop} onRaw={noop} />,
    );

    expect(screen.getByRole("button", { name: "Formatted" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Raw" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    rerender(<LogFormatToggle raw={true} onFormatted={noop} onRaw={noop} />);
    expect(screen.getByRole("button", { name: "Raw" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("calls onRaw when Raw is clicked and onFormatted when Formatted is clicked", () => {
    const onFormatted = vi.fn();
    const onRaw = vi.fn();

    render(
      <LogFormatToggle raw={false} onFormatted={onFormatted} onRaw={onRaw} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Raw" }));
    expect(onRaw).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Formatted" }));
    expect(onFormatted).toHaveBeenCalled();
  });
});
