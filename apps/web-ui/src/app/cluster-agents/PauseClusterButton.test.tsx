// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PauseClusterButton from "./PauseClusterButton";

describe("PauseClusterButton", () => {
  it("offers Pause for a running cluster and asks to pause it", () => {
    const toggle = vi.fn().mockResolvedValue(undefined);

    render(<PauseClusterButton paused={false} toggle={toggle} />);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));

    expect(toggle).toHaveBeenCalledWith(true);
  });

  it("offers Resume for a paused cluster and asks to un-pause it", () => {
    const toggle = vi.fn().mockResolvedValue(undefined);

    render(<PauseClusterButton paused toggle={toggle} />);
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));

    expect(toggle).toHaveBeenCalledWith(false);
  });
});
